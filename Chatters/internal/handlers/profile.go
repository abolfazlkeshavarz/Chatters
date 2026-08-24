package handlers

import (
	"net/http"

	"messenger/internal/db"
	"messenger/internal/validate"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

// ChangeUsername renames the account. The foreign keys onto users(id) are
// declared ON UPDATE CASCADE by the migrations, so chat membership, message
// authorship and key material all follow the rename automatically — the old
// code updated chat_members by hand and silently left messages behind.
func ChangeUsername(c *gin.Context) {
	current := c.GetString("user_id")

	var req struct {
		NewUsername string `json:"new_username"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	newUsername, err := validate.Username(req.NewUsername)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if newUsername == current {
		c.JSON(http.StatusBadRequest, gin.H{"error": "that is already your username"})
		return
	}

	// Bump token_version so the tokens carrying the old id stop working.
	_, err = db.DB.Exec(
		`UPDATE users SET id = $1, token_version = token_version + 1 WHERE id = $2`,
		newUsername, current,
	)
	if err != nil {
		if isUniqueViolation(err, "users_pkey") {
			c.JSON(http.StatusConflict, gin.H{"error": "username already taken"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update username"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "username updated, please login again"})
}

// ChangePassword rotates the password. Because the user's end-to-end private
// key is wrapped with a key derived from their password, the client must
// re-wrap it under the new password and send the new bundle in the same
// request — otherwise they would lose access to their encrypted chats.
func ChangePassword(c *gin.Context) {
	user := c.GetString("user_id")

	var req struct {
		OldPassword string     `json:"old_password"`
		NewPassword string     `json:"new_password"`
		Keys        *KeyBundle `json:"keys"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	if err := validate.Password(req.NewPassword); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var hash string
	if err := db.DB.QueryRow(`SELECT password_hash FROM users WHERE id = $1`, user).Scan(&hash); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "incorrect old password"})
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.OldPassword)) != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "incorrect old password"})
		return
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "password error"})
		return
	}

	tx, err := db.DB.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	defer tx.Rollback()

	if _, err := tx.Exec(
		`UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2`,
		string(newHash), user,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update password"})
		return
	}

	if req.Keys != nil && req.Keys.complete() {
		if _, err := tx.Exec(
			`UPDATE users
			 SET public_key = $1, encrypted_private_key = $2, key_salt = $3, key_nonce = $4
			 WHERE id = $5`,
			req.Keys.PublicKey, req.Keys.EncryptedPrivateKey, req.Keys.KeySalt, req.Keys.KeyNonce, user,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update keys"})
			return
		}
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "commit failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "password updated, please login again"})
}

// Me reports the caller's own account state.
func Me(c *gin.Context) {
	userID := c.GetString("user_id")
	isAdmin, _ := c.Get("is_admin")

	var hasKeys bool
	_ = db.DB.QueryRow(
		`SELECT public_key IS NOT NULL AND public_key <> '' FROM users WHERE id = $1`,
		userID,
	).Scan(&hasKeys)

	c.JSON(http.StatusOK, gin.H{
		"user_id":  userID,
		"username": userID,
		"is_admin": isAdmin == true,
		"has_keys": hasKeys,
	})
}
