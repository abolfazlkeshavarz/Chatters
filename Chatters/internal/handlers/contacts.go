package handlers

import (
	"database/sql"
	"net/http"
	"strings"

	"messenger/internal/db"

	"github.com/gin-gonic/gin"
)

type Contact struct {
	ID        string `json:"id"`
	HasKeys   bool   `json:"has_keys"`
	CreatedAt string `json:"created_at"`
}

// ListContacts returns the caller's contacts, most recently added first —
// what populates the "New chat" / "New group" picker.
func ListContacts(c *gin.Context) {
	userID := c.GetString("user_id")

	rows, err := db.DB.Query(
		`SELECT u.id, (u.public_key IS NOT NULL AND u.public_key <> ''), ct.created_at
		 FROM contacts ct
		 JOIN users u ON u.id = ct.contact_id
		 WHERE ct.owner_id = $1
		 ORDER BY ct.created_at DESC`,
		userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load contacts"})
		return
	}
	defer rows.Close()

	contacts := []Contact{}
	for rows.Next() {
		var ct Contact
		var createdAt sql.NullTime
		if err := rows.Scan(&ct.ID, &ct.HasKeys, &createdAt); err != nil {
			continue
		}
		if createdAt.Valid {
			ct.CreatedAt = createdAt.Time.Format("2006-01-02T15:04:05Z07:00")
		}
		contacts = append(contacts, ct)
	}

	c.JSON(http.StatusOK, gin.H{"contacts": contacts})
}

// AddContact adds a user as a contact by username. One-directional: it does
// not require or imply that they add you back, and does not notify them —
// this only populates your own picker.
func AddContact(c *gin.Context) {
	userID := c.GetString("user_id")

	var req struct {
		Username string `json:"username"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	target := strings.TrimSpace(req.Username)
	if target == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "username required"})
		return
	}
	if target == userID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "you cannot add yourself as a contact"})
		return
	}

	var exists bool
	if err := db.DB.QueryRow(`SELECT EXISTS (SELECT 1 FROM users WHERE id = $1)`, target).Scan(&exists); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to look up user"})
		return
	}
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "no user with that username"})
		return
	}

	res, err := db.DB.Exec(
		`INSERT INTO contacts (owner_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		userID, target,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to add contact"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusConflict, gin.H{"error": target + " is already in your contacts"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok", "id": target})
}

func RemoveContact(c *gin.Context) {
	userID := c.GetString("user_id")
	target := c.Param("id")

	res, err := db.DB.Exec(
		`DELETE FROM contacts WHERE owner_id = $1 AND contact_id = $2`,
		userID, target,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to remove contact"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "not in your contacts"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
