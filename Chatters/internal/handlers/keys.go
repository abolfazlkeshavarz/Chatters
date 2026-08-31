package handlers

import (
	"database/sql"
	"net/http"

	"messenger/internal/db"

	"github.com/gin-gonic/gin"
)

// UploadKeys stores the caller's end-to-end encryption bundle. The private key
// is already wrapped under a password-derived key by the browser; the server
// treats it as opaque bytes and has no way to unwrap it.
func UploadKeys(c *gin.Context) {
	userID := c.GetString("user_id")

	var req KeyBundle
	if err := c.ShouldBindJSON(&req); err != nil || !req.complete() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "incomplete key bundle"})
		return
	}

	_, err := db.DB.Exec(
		`UPDATE users
		 SET public_key = $1, encrypted_private_key = $2, key_salt = $3, key_nonce = $4
		 WHERE id = $5`,
		req.PublicKey, req.EncryptedPrivateKey, req.KeySalt, req.KeyNonce, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to store keys"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// GetMyKeys returns the caller's own wrapped private key so a new device can
// unwrap it locally with the account password.
func GetMyKeys(c *gin.Context) {
	userID := c.GetString("user_id")

	var pub, priv, salt, nonce sql.NullString
	err := db.DB.QueryRow(
		`SELECT public_key, encrypted_private_key, key_salt, key_nonce FROM users WHERE id = $1`,
		userID,
	).Scan(&pub, &priv, &salt, &nonce)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	bundle := KeyBundle{
		PublicKey:           pub.String,
		EncryptedPrivateKey: priv.String,
		KeySalt:             salt.String,
		KeyNonce:            nonce.String,
	}

	c.JSON(http.StatusOK, gin.H{"keys": bundle, "needs_key_setup": !bundle.complete()})
}

// GetChatKeys returns the public key of every member of a chat, which is what
// the sender needs to wrap a message key for each recipient.
func GetChatKeys(c *gin.Context) {
	chatID := c.Param("id")
	userID := c.GetString("user_id")

	if !isChatMember(chatID, userID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a chat member"})
		return
	}

	rows, err := db.DB.Query(
		`SELECT u.id, u.public_key
		 FROM chat_members cm
		 JOIN users u ON u.id = cm.user_id
		 WHERE cm.chat_id = $1`,
		chatID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load keys"})
		return
	}
	defer rows.Close()

	type memberKey struct {
		UserID    string `json:"user_id"`
		PublicKey string `json:"public_key"`
	}

	members := []memberKey{}
	missing := []string{}

	for rows.Next() {
		var id string
		var pub sql.NullString
		if err := rows.Scan(&id, &pub); err != nil {
			continue
		}
		if pub.Valid && pub.String != "" {
			members = append(members, memberKey{UserID: id, PublicKey: pub.String})
		} else {
			// A member who has not logged in since E2E shipped has no key yet
			// and cannot be included as a recipient.
			missing = append(missing, id)
		}
	}

	c.JSON(http.StatusOK, gin.H{"members": members, "without_keys": missing})
}

func isChatMember(chatID, userID string) bool {
	var ok bool
	err := db.DB.QueryRow(
		`SELECT EXISTS (SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2)`,
		chatID, userID,
	).Scan(&ok)
	return err == nil && ok
}
