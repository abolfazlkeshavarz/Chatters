package handlers

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"time"

	"messenger/internal/db"
	"messenger/internal/validate"

	"github.com/gin-gonic/gin"
)

type phoneRequest struct {
	ID        int        `json:"id"`
	UserID    string     `json:"user_id"`
	Phone     string     `json:"phone"`
	Status    string     `json:"status"`
	Note      *string    `json:"note,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	DecidedAt *time.Time `json:"decided_at,omitempty"`
	DecidedBy *string    `json:"decided_by,omitempty"`
	Current   *string    `json:"current_phone,omitempty"`
	Taken     bool       `json:"taken"`
}

// RequestPhone files a request to set or change the caller's phone number.
//
// The number is not written to the account here. A verified number is how
// other people find you, so letting anyone self-assign one would let them
// claim a number that is not theirs and be discovered as its owner — an
// administrator approves it instead.
func RequestPhone(c *gin.Context) {
	userID := c.GetString("user_id")

	var req struct {
		Phone string `json:"phone"`
		Note  string `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	phone, err := validate.Phone(req.Phone)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var current sql.NullString
	if err := db.DB.QueryRow(`SELECT phone FROM users WHERE id = $1`, userID).Scan(&current); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	if current.Valid && current.String == phone {
		c.JSON(http.StatusBadRequest, gin.H{"error": "that is already your phone number"})
		return
	}

	var taken bool
	if err := db.DB.QueryRow(
		`SELECT EXISTS (SELECT 1 FROM users WHERE phone = $1 AND id <> $2)`, phone, userID,
	).Scan(&taken); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	if taken {
		c.JSON(http.StatusConflict, gin.H{"error": "that phone number already belongs to another account"})
		return
	}

	note := strings.TrimSpace(req.Note)
	if len(note) > 300 {
		note = note[:300]
	}

	// Replacing rather than rejecting a second submission: someone who mistyped
	// their number should be able to correct it without waiting for an admin to
	// reject the first attempt.
	_, err = db.DB.Exec(
		`INSERT INTO phone_requests (user_id, phone, note) VALUES ($1, $2, NULLIF($3,''))
		 ON CONFLICT (user_id) WHERE status = 'pending'
		 DO UPDATE SET phone = EXCLUDED.phone, note = EXCLUDED.note, created_at = now()`,
		userID, phone, note,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to submit the request"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":  "pending",
		"phone":   phone,
		"message": "your phone number is waiting for an administrator to verify it",
	})
}

// MyPhoneRequest reports the caller's own pending request, so the profile page
// can show "waiting for approval" instead of looking like nothing happened.
func MyPhoneRequest(c *gin.Context) {
	userID := c.GetString("user_id")

	var (
		id    int
		phone string
		at    time.Time
	)
	err := db.DB.QueryRow(
		`SELECT id, phone, created_at FROM phone_requests
		 WHERE user_id = $1 AND status = 'pending'`,
		userID,
	).Scan(&id, &phone, &at)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"request": nil})
		return
	}

	c.JSON(http.StatusOK, gin.H{"request": gin.H{
		"id": id, "phone": phone, "created_at": at, "status": "pending",
	}})
}

// CancelPhoneRequest withdraws the caller's own pending request.
func CancelPhoneRequest(c *gin.Context) {
	userID := c.GetString("user_id")

	res, err := db.DB.Exec(
		`DELETE FROM phone_requests WHERE user_id = $1 AND status = 'pending'`, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to cancel"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "you have no pending request"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "cancelled"})
}

// RemoveMyPhone clears the caller's own number. Removing is not a privileged
// action — it only ever makes you harder to find, never easier.
func RemoveMyPhone(c *gin.Context) {
	userID := c.GetString("user_id")

	if _, err := db.DB.Exec(
		`UPDATE users SET phone = NULL, phone_verified = false WHERE id = $1`, userID,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to remove the number"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "removed"})
}

/* ------------------------------------------------------------ admin side */

// AdminListPhoneRequests backs the "Verify phone numbers" tab.
func AdminListPhoneRequests(c *gin.Context) {
	status := c.DefaultQuery("status", "pending")
	if status != "pending" && status != "approved" && status != "rejected" && status != "all" {
		status = "pending"
	}

	rows, err := db.DB.Query(
		`SELECT p.id, p.user_id, p.phone, p.status, p.note,
		        p.created_at, p.decided_at, p.decided_by,
		        u.phone AS current_phone,
		        EXISTS (SELECT 1 FROM users x WHERE x.phone = p.phone AND x.id <> p.user_id) AS taken
		 FROM phone_requests p
		 JOIN users u ON u.id = p.user_id
		 WHERE ($1 = 'all' OR p.status = $1)
		 ORDER BY (p.status = 'pending') DESC, p.created_at DESC
		 LIMIT 300`,
		status,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list phone requests"})
		return
	}
	defer rows.Close()

	out := []phoneRequest{}
	for rows.Next() {
		var r phoneRequest
		var note, decidedBy, current sql.NullString
		var decidedAt sql.NullTime

		if err := rows.Scan(
			&r.ID, &r.UserID, &r.Phone, &r.Status, &note,
			&r.CreatedAt, &decidedAt, &decidedBy, &current, &r.Taken,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read phone requests"})
			return
		}
		r.Note = nullStr(note)
		r.DecidedBy = nullStr(decidedBy)
		r.Current = nullStr(current)
		if decidedAt.Valid {
			r.DecidedAt = &decidedAt.Time
		}
		out = append(out, r)
	}

	var pending int
	_ = db.DB.QueryRow(`SELECT COUNT(*) FROM phone_requests WHERE status = 'pending'`).Scan(&pending)

	c.JSON(http.StatusOK, gin.H{"requests": out, "pending": pending})
}

// AdminApprovePhoneRequest writes the number onto the account and marks it
// verified, in one transaction so an approved request always matches reality.
func AdminApprovePhoneRequest(c *gin.Context) {
	actor := c.GetString("user_id")

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request id"})
		return
	}

	tx, err := db.DB.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	defer tx.Rollback()

	var userID, phone, status string
	err = tx.QueryRow(
		`SELECT user_id, phone, status FROM phone_requests WHERE id = $1 FOR UPDATE`, id,
	).Scan(&userID, &phone, &status)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "request not found"})
		return
	}
	if status != "pending" {
		c.JSON(http.StatusConflict, gin.H{"error": "this request was already " + status})
		return
	}

	if _, err := tx.Exec(
		`UPDATE users SET phone = $1, phone_verified = true WHERE id = $2`, phone, userID,
	); err != nil {
		if isUniqueViolation(err, "idx_users_phone") {
			c.JSON(http.StatusConflict, gin.H{"error": "that number was claimed by another account in the meantime"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to set the number"})
		return
	}

	if _, err := tx.Exec(
		`UPDATE phone_requests SET status = 'approved', decided_at = now(), decided_by = $1 WHERE id = $2`,
		actor, id,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update the request"})
		return
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "commit failed"})
		return
	}

	auditLog(actor, "phone.approve", userID, phone)
	c.JSON(http.StatusOK, gin.H{"status": "approved", "user_id": userID, "phone": phone})
}

func AdminRejectPhoneRequest(c *gin.Context) {
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

	res, err := db.DB.Exec(
		`UPDATE phone_requests
		 SET status = 'rejected', note = COALESCE(NULLIF($1,''), note),
		     decided_at = now(), decided_by = $2
		 WHERE id = $3 AND status = 'pending'`,
		strings.TrimSpace(req.Reason), actor, id,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reject"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "no pending request with that id"})
		return
	}

	auditLog(actor, "phone.reject", strconv.Itoa(id), req.Reason)
	c.JSON(http.StatusOK, gin.H{"status": "rejected"})
}

// AdminSetUserPhone lets an admin set or clear a number directly, without the
// user having asked — the counterpart to editing any other account field.
func AdminSetUserPhone(c *gin.Context) {
	actor := c.GetString("user_id")
	target := c.Param("id")

	var req struct {
		Phone string `json:"phone"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if strings.TrimSpace(req.Phone) == "" {
		if _, err := db.DB.Exec(
			`UPDATE users SET phone = NULL, phone_verified = false WHERE id = $1`, target,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to clear the number"})
			return
		}
		auditLog(actor, "phone.clear", target, "")
		c.JSON(http.StatusOK, gin.H{"status": "cleared"})
		return
	}

	phone, err := validate.Phone(req.Phone)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	res, err := db.DB.Exec(
		`UPDATE users SET phone = $1, phone_verified = true WHERE id = $2`, phone, target,
	)
	if err != nil {
		if isUniqueViolation(err, "idx_users_phone") {
			c.JSON(http.StatusConflict, gin.H{"error": "that phone number already belongs to another account"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to set the number"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	auditLog(actor, "phone.set", target, phone)
	c.JSON(http.StatusOK, gin.H{"status": "ok", "phone": phone})
}
