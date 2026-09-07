package handlers

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"time"

	"messenger/internal/db"

	"github.com/gin-gonic/gin"
)

type registrationRequest struct {
	ID         int        `json:"id"`
	Username   string     `json:"username"`
	Email      string     `json:"email"`
	Phone      *string    `json:"phone,omitempty"`
	HasKeys    bool       `json:"has_keys"`
	Status     string     `json:"status"`
	Reason     *string    `json:"reason,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	DecidedAt  *time.Time `json:"decided_at,omitempty"`
	DecidedBy  *string    `json:"decided_by,omitempty"`
	Conflicts  []string   `json:"conflicts"`
}

// AdminListRegistrations returns signup requests, pending first by default.
//
// Each row carries a `conflicts` list computed against the live users table:
// a request can sit in the queue long enough for someone else to take the
// username or email, and approving it would then fail on a constraint. Telling
// the admin up front is better than a 409 after they click Approve.
func AdminListRegistrations(c *gin.Context) {
	status := c.DefaultQuery("status", "pending")
	if status != "pending" && status != "approved" && status != "rejected" && status != "all" {
		status = "pending"
	}

	limit := 100
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 && v <= 500 {
		limit = v
	}
	offset := 0
	if v, err := strconv.Atoi(c.Query("offset")); err == nil && v > 0 {
		offset = v
	}

	rows, err := db.DB.Query(
		`SELECT r.id, r.username, r.email, r.phone,
		        r.public_key IS NOT NULL,
		        r.status, r.reason, r.created_at, r.decided_at, r.decided_by,
		        EXISTS (SELECT 1 FROM users u WHERE u.id = r.username)        AS username_taken,
		        EXISTS (SELECT 1 FROM users u WHERE u.email = r.email)        AS email_taken,
		        EXISTS (SELECT 1 FROM users u WHERE r.phone IS NOT NULL
		                                       AND u.phone = r.phone)         AS phone_taken
		 FROM registration_requests r
		 WHERE ($1 = 'all' OR r.status = $1)
		 ORDER BY (r.status = 'pending') DESC, r.created_at DESC
		 LIMIT $2 OFFSET $3`,
		status, limit, offset,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list requests"})
		return
	}
	defer rows.Close()

	out := []registrationRequest{}
	for rows.Next() {
		var r registrationRequest
		var phone, reason, decidedBy sql.NullString
		var decidedAt sql.NullTime
		var usernameTaken, emailTaken, phoneTaken bool

		if err := rows.Scan(
			&r.ID, &r.Username, &r.Email, &phone, &r.HasKeys,
			&r.Status, &reason, &r.CreatedAt, &decidedAt, &decidedBy,
			&usernameTaken, &emailTaken, &phoneTaken,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read requests"})
			return
		}

		r.Phone = nullStr(phone)
		r.Reason = nullStr(reason)
		r.DecidedBy = nullStr(decidedBy)
		if decidedAt.Valid {
			r.DecidedAt = &decidedAt.Time
		}

		r.Conflicts = []string{}
		if usernameTaken {
			r.Conflicts = append(r.Conflicts, "username")
		}
		if emailTaken {
			r.Conflicts = append(r.Conflicts, "email")
		}
		if phoneTaken {
			r.Conflicts = append(r.Conflicts, "phone")
		}

		out = append(out, r)
	}

	var pending int
	_ = db.DB.QueryRow(`SELECT COUNT(*) FROM registration_requests WHERE status = 'pending'`).Scan(&pending)

	c.JSON(http.StatusOK, gin.H{"requests": out, "pending": pending})
}

// AdminApproveRegistration turns a pending request into a real account.
//
// The whole thing is one transaction: the request must not be marked approved
// unless the user row actually landed, or a duplicate-username failure would
// leave a request that claims an account exists when it does not.
func AdminApproveRegistration(c *gin.Context) {
	actor := c.GetString("user_id")

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request id"})
		return
	}

	var req struct {
		// Lets the admin grant the requested number in the same step. A number
		// approved by a human here is verified by definition.
		VerifyPhone bool `json:"verify_phone"`
		MakeAdmin   bool `json:"make_admin"`
	}
	_ = c.ShouldBindJSON(&req)

	tx, err := db.DB.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	defer tx.Rollback()

	var (
		username, email, passwordHash, status string
		phone, pub, priv, salt, nonce         sql.NullString
	)
	// FOR UPDATE so two admins clicking Approve at the same moment cannot both
	// pass the status check and try to create the account twice.
	err = tx.QueryRow(
		`SELECT username, email, phone, password_hash,
		        public_key, encrypted_private_key, key_salt, key_nonce, status
		 FROM registration_requests WHERE id = $1 FOR UPDATE`,
		id,
	).Scan(&username, &email, &phone, &passwordHash, &pub, &priv, &salt, &nonce, &status)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "request not found"})
		return
	}
	if status != "pending" {
		c.JSON(http.StatusConflict, gin.H{"error": "this request was already " + status})
		return
	}

	usePhone := phone
	if !req.VerifyPhone {
		usePhone = sql.NullString{}
	}

	_, err = tx.Exec(
		`INSERT INTO users
		   (id, email, phone, phone_verified, password_hash, is_admin,
		    public_key, encrypted_private_key, key_salt, key_nonce)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		username, email, usePhone, usePhone.Valid, passwordHash, req.MakeAdmin,
		pub, priv, salt, nonce,
	)
	if err != nil {
		switch {
		case isUniqueViolation(err, "users_pkey"):
			c.JSON(http.StatusConflict, gin.H{"error": "that username was taken while this request was waiting"})
		case isUniqueViolation(err, "users_email_key"):
			c.JSON(http.StatusConflict, gin.H{"error": "that email was registered while this request was waiting"})
		case isUniqueViolation(err, "idx_users_phone"):
			c.JSON(http.StatusConflict, gin.H{"error": "that phone number already belongs to another account"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create the account"})
		}
		return
	}

	if _, err := tx.Exec(
		`UPDATE registration_requests
		 SET status = 'approved', decided_at = now(), decided_by = $1
		 WHERE id = $2`,
		actor, id,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update the request"})
		return
	}

	// A phone the admin chose not to grant is still worth keeping: it becomes a
	// pending verification request so it shows up in the phone queue instead of
	// being silently dropped.
	if phone.Valid && !req.VerifyPhone {
		if _, err := tx.Exec(
			`INSERT INTO phone_requests (user_id, phone, note)
			 VALUES ($1, $2, 'submitted during signup')`,
			username, phone.String,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to queue the phone number"})
			return
		}
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "commit failed"})
		return
	}

	auditLog(actor, "registration.approve", username, "email="+email)
	c.JSON(http.StatusOK, gin.H{"status": "approved", "username": username})
}

func AdminRejectRegistration(c *gin.Context) {
	actor := c.GetString("user_id")

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request id"})
		return
	}

	var req struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&req)
	reason := strings.TrimSpace(req.Reason)
	if len(reason) > 500 {
		reason = reason[:500]
	}

	res, err := db.DB.Exec(
		`UPDATE registration_requests
		 SET status = 'rejected', reason = NULLIF($1,''), decided_at = now(), decided_by = $2
		 WHERE id = $3 AND status = 'pending'`,
		reason, actor, id,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reject the request"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "no pending request with that id"})
		return
	}

	auditLog(actor, "registration.reject", strconv.Itoa(id), reason)
	c.JSON(http.StatusOK, gin.H{"status": "rejected"})
}

// AdminDeleteRegistration clears a decided request out of the history. Pending
// ones must be approved or rejected first, so nothing is silently discarded.
func AdminDeleteRegistration(c *gin.Context) {
	actor := c.GetString("user_id")

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request id"})
		return
	}

	res, err := db.DB.Exec(
		`DELETE FROM registration_requests WHERE id = $1 AND status <> 'pending'`, id,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete the request"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "decide on the request before deleting it"})
		return
	}

	auditLog(actor, "registration.delete", strconv.Itoa(id), "")
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}
