package handlers

import (
	"database/sql"
	"net/http"
	"strconv"
	"time"

	"messenger/internal/db"
	"messenger/internal/validate"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

type adminUser struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	IsAdmin   bool      `json:"is_admin"`
	HasKeys   bool      `json:"has_keys"`
	CreatedAt time.Time `json:"created_at"`
	ChatCount int       `json:"chat_count"`
}

// AdminListUsers returns a paginated, optionally filtered user list.
func AdminListUsers(c *gin.Context) {
	search := "%" + c.Query("search") + "%"

	limit := 50
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 && v <= 200 {
		limit = v
	}
	offset := 0
	if v, err := strconv.Atoi(c.Query("offset")); err == nil && v > 0 {
		offset = v
	}

	rows, err := db.DB.Query(
		`SELECT u.id, u.email, u.is_admin, u.public_key IS NOT NULL, u.created_at,
		        (SELECT COUNT(*) FROM chat_members cm WHERE cm.user_id = u.id)
		 FROM users u
		 WHERE u.id ILIKE $1 OR u.email ILIKE $1
		 ORDER BY u.created_at DESC
		 LIMIT $2 OFFSET $3`,
		search, limit, offset,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list users"})
		return
	}
	defer rows.Close()

	users := []adminUser{}
	for rows.Next() {
		var u adminUser
		if err := rows.Scan(&u.ID, &u.Email, &u.IsAdmin, &u.HasKeys, &u.CreatedAt, &u.ChatCount); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read users"})
			return
		}
		users = append(users, u)
	}

	var total int
	_ = db.DB.QueryRow(`SELECT COUNT(*) FROM users WHERE id ILIKE $1 OR email ILIKE $1`, search).Scan(&total)

	c.JSON(http.StatusOK, gin.H{"users": users, "total": total})
}

func AdminCreateUser(c *gin.Context) {
	var req struct {
		Username string `json:"username"`
		Email    string `json:"email"`
		Password string `json:"password"`
		IsAdmin  bool   `json:"is_admin"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	username, err := validate.Username(req.Username)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	email, err := validate.Email(req.Email)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validate.Password(req.Password); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "password error"})
		return
	}

	// No key material: an admin cannot generate a user's E2E keys because that
	// would require knowing their password. The account bootstraps its own key
	// pair on first login.
	_, err = db.DB.Exec(
		`INSERT INTO users (id, email, password_hash, is_admin) VALUES ($1, $2, $3, $4)`,
		username, email, string(hash), req.IsAdmin,
	)
	if err != nil {
		if isUniqueViolation(err, "users_pkey") {
			c.JSON(http.StatusConflict, gin.H{"error": "username already taken"})
			return
		}
		if isUniqueViolation(err, "users_email_key") {
			c.JSON(http.StatusConflict, gin.H{"error": "email already registered"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create user"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "created", "username": username})
}

func AdminDeleteUser(c *gin.Context) {
	target := c.Param("id")
	me := c.GetString("user_id")

	if target == me {
		c.JSON(http.StatusBadRequest, gin.H{"error": "you cannot delete your own account"})
		return
	}

	// Refuse to remove the last remaining admin, which would lock everyone out
	// of the admin panel permanently.
	if locked, msg := wouldOrphanAdmins(target); locked {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}

	res, err := db.DB.Exec(`DELETE FROM users WHERE id = $1`, target)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete user"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

// AdminResetPassword sets a new password and invalidates every existing
// session for that account.
//
// Note this necessarily destroys the user's end-to-end encryption identity:
// their private key is wrapped with their old password, which nobody
// (including the server) can recover. The account generates a fresh key pair
// on next login and loses access to previously encrypted history.
func AdminResetPassword(c *gin.Context) {
	target := c.Param("id")

	var req struct {
		NewPassword string `json:"new_password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	if err := validate.Password(req.NewPassword); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "password error"})
		return
	}

	res, err := db.DB.Exec(
		`UPDATE users
		 SET password_hash = $1,
		     token_version = token_version + 1,
		     public_key = NULL,
		     encrypted_private_key = NULL,
		     key_salt = NULL,
		     key_nonce = NULL
		 WHERE id = $2`,
		string(hash), target,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reset password"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":  "password reset",
		"warning": "the user's encryption keys were cleared; previously encrypted messages are no longer readable by them",
	})
}

func AdminSetRole(c *gin.Context) {
	target := c.Param("id")
	me := c.GetString("user_id")

	var req struct {
		IsAdmin bool `json:"is_admin"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	if target == me && !req.IsAdmin {
		c.JSON(http.StatusBadRequest, gin.H{"error": "you cannot remove your own admin access"})
		return
	}
	if !req.IsAdmin {
		if locked, msg := wouldOrphanAdmins(target); locked {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}
	}

	res, err := db.DB.Exec(`UPDATE users SET is_admin = $1 WHERE id = $2`, req.IsAdmin, target)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update role"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "updated"})
}

func AdminStats(c *gin.Context) {
	var users, chats, messages, encrypted, e2eChats int

	_ = db.DB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&users)
	_ = db.DB.QueryRow(`SELECT COUNT(*) FROM chats`).Scan(&chats)
	_ = db.DB.QueryRow(`SELECT COUNT(*) FROM messages`).Scan(&messages)
	_ = db.DB.QueryRow(`SELECT COUNT(*) FROM messages WHERE is_encrypted`).Scan(&encrypted)
	_ = db.DB.QueryRow(`SELECT COUNT(*) FROM chats WHERE e2e_enabled`).Scan(&e2eChats)

	c.JSON(http.StatusOK, gin.H{
		"users":              users,
		"chats":              chats,
		"messages":           messages,
		"encrypted_messages": encrypted,
		"e2e_chats":          e2eChats,
	})
}

// wouldOrphanAdmins reports whether demoting or deleting target leaves the
// system with no administrator.
func wouldOrphanAdmins(target string) (bool, string) {
	var targetIsAdmin bool
	if err := db.DB.QueryRow(`SELECT is_admin FROM users WHERE id = $1`, target).Scan(&targetIsAdmin); err != nil {
		if err == sql.ErrNoRows {
			return false, ""
		}
		return true, "failed to verify admin count"
	}
	if !targetIsAdmin {
		return false, ""
	}

	var admins int
	if err := db.DB.QueryRow(`SELECT COUNT(*) FROM users WHERE is_admin`).Scan(&admins); err != nil {
		return true, "failed to verify admin count"
	}
	if admins <= 1 {
		return true, "cannot remove the last administrator"
	}
	return false, ""
}
