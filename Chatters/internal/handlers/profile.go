package handlers

import (
	"messenger/internal/db"
	"golang.org/x/crypto/bcrypt"
	"github.com/gin-gonic/gin"
)
func ChangeUsername(c *gin.Context) {
	current := c.GetString("user_id")

	var req struct {
		NewUsername string `json:"new_username"`
	}

	if err := c.ShouldBindJSON(&req); err != nil || req.NewUsername == "" {
		c.JSON(400, gin.H{"error": "invalid request"})
		return
	}

	// Check uniqueness
	var exists bool
	db.DB.QueryRow(
		`SELECT EXISTS (SELECT 1 FROM users WHERE id = $1)`,
		req.NewUsername,
	).Scan(&exists)

	if exists {
		c.JSON(400, gin.H{"error": "username already taken"})
		return
	}

	tx, err := db.DB.Begin()
	if err != nil {
		c.JSON(500, gin.H{"error": "db error"})
		return
	}
	defer tx.Rollback()

	// Update users table
	_, err = tx.Exec(
		`UPDATE users SET id = $1 WHERE id = $2`,
		req.NewUsername, current,
	)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	// Update chat_members
	_, err = tx.Exec(
		`UPDATE chat_members SET user_id = $1 WHERE user_id = $2`,
		req.NewUsername, current,
	)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	if err = tx.Commit(); err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	// Force re-login
	c.JSON(200, gin.H{
		"message": "username updated, please login again",
	})
}
func ChangePassword(c *gin.Context) {
	user := c.GetString("user_id")

	var req struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "invalid request"})
		return
	}

	var hash string
	err := db.DB.QueryRow(
		`SELECT password_hash FROM users WHERE id = $1`,
		user,
	).Scan(&hash)

	if err != nil || bcrypt.CompareHashAndPassword(
		[]byte(hash), []byte(req.OldPassword),
	) != nil {
		c.JSON(401, gin.H{"error": "incorrect old password"})
		return
	}

	newHash, _ := bcrypt.GenerateFromPassword(
		[]byte(req.NewPassword),
		bcrypt.DefaultCost,
	)

	_, err = db.DB.Exec(
		`UPDATE users SET password_hash = $1 WHERE id = $2`,
		string(newHash), user,
	)

	if err != nil {
		c.JSON(500, gin.H{"error": "failed to update password"})
		return
	}

	c.JSON(200, gin.H{"message": "password updated"})
}
