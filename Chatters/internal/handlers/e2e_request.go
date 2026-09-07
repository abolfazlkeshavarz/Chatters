package handlers

import (
	"database/sql"
	"net/http"

	"messenger/internal/db"

	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
)

// Secret chats replaced the old "encrypt this chat in place" handshake. A
// request now creates a dedicated pending 1:1 chat (see CreateSecretChat);
// these handlers drive that chat's lifecycle.

// RequestChatE2E is the compatibility entry point kept for the "🔒" button
// inside a normal 1:1 chat: it starts a secret chat with the OTHER member of
// chat :id instead of upgrading that chat.
func RequestChatE2E(c *gin.Context) {
	sourceChatID := c.Param("id")
	me := c.GetString("user_id")

	if !isChatMember(sourceChatID, me) {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a chat member"})
		return
	}

	var isGroup bool
	var members []string
	if err := db.DB.QueryRow(`SELECT c.is_group FROM chats c WHERE c.id = $1`, sourceChatID).Scan(&isGroup); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "chat not found"})
		return
	}
	if isGroup {
		c.JSON(http.StatusBadRequest, gin.H{"error": "secret chats are one-to-one only"})
		return
	}

	rows, _ := db.DB.Query(`SELECT user_id FROM chat_members WHERE chat_id = $1`, sourceChatID)
	if rows != nil {
		for rows.Next() {
			var u string
			if rows.Scan(&u) == nil {
				members = append(members, u)
			}
		}
		rows.Close()
	}

	var peer string
	for _, m := range members {
		if m != me {
			peer = m
		}
	}
	if peer == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "could not identify the other member"})
		return
	}

	chatID, status, code, errMsg := startSecretChat(me, peer)
	if errMsg != "" {
		c.JSON(code, gin.H{"error": errMsg})
		return
	}
	c.JSON(http.StatusOK, gin.H{"chat_id": chatID, "status": status})
}

// AcceptChatE2E completes the handshake on secret chat :id. Only the member
// who did NOT send the request may accept.
func AcceptChatE2E(c *gin.Context) {
	chatID := c.Param("id")
	me := c.GetString("user_id")

	requestedBy, ok := pendingRequester(c, chatID, me)
	if !ok {
		return
	}
	if requestedBy == me {
		c.JSON(http.StatusConflict, gin.H{"error": "you cannot accept your own request"})
		return
	}

	res, err := db.DB.Exec(
		`UPDATE chats SET e2e_status = 'accepted', e2e_enabled = true
		 WHERE id = $1 AND e2e_status = 'pending'`,
		chatID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to enable encryption"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "no pending request for this chat"})
		return
	}

	notifySecretChatState(chatID, me, "e2e_accepted")
	c.JSON(http.StatusOK, gin.H{"status": "ok", "e2e_enabled": true, "chat_id": chatID})
}

// RejectChatE2E declines secret chat :id. The pending chat is removed for both
// sides.
func RejectChatE2E(c *gin.Context) {
	chatID := c.Param("id")
	me := c.GetString("user_id")

	requestedBy, ok := pendingRequester(c, chatID, me)
	if !ok {
		return
	}
	if requestedBy == me {
		c.JSON(http.StatusConflict, gin.H{"error": "you cannot reject your own request"})
		return
	}

	// Tell everyone first, while the chat (and its membership rows) still
	// exist, then drop it.
	notifySecretChatState(chatID, me, "e2e_rejected")

	if _, err := db.DB.Exec(`DELETE FROM chats WHERE id = $1 AND e2e_status = 'pending'`, chatID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reject request"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// startSecretChat creates (or returns) a pending secret chat between two users.
// Shared by CreateSecretChat (called with an explicit peer) and RequestChatE2E
// (peer derived from a 1:1 chat). Returns an HTTP status + message on failure.
func startSecretChat(me, peer string) (chatID, status string, code int, errMsg string) {
	if peer == me {
		return "", "", http.StatusBadRequest, "you cannot start a secret chat with yourself"
	}

	var keyed int
	if err := db.DB.QueryRow(
		`SELECT COUNT(*) FROM users
		 WHERE id IN ($1, $2) AND public_key IS NOT NULL AND public_key <> ''`,
		me, peer,
	).Scan(&keyed); err != nil {
		return "", "", http.StatusInternalServerError, "failed to verify keys"
	}
	if keyed < 2 {
		return "", "", http.StatusConflict,
			"both people must sign in once to publish an encryption key before a secret chat can start"
	}

	var existing string
	err := db.DB.QueryRow(
		`SELECT c.id
		   FROM chats c
		   JOIN chat_members a ON a.chat_id = c.id AND a.user_id = $1
		   JOIN chat_members b ON b.chat_id = c.id AND b.user_id = $2
		  WHERE c.is_secret
		    AND (SELECT COUNT(*) FROM chat_members m WHERE m.chat_id = c.id) = 2
		  LIMIT 1`,
		me, peer,
	).Scan(&existing)
	if err == nil && existing != "" {
		return existing, "existing", http.StatusOK, ""
	}

	tx, err := db.DB.Begin()
	if err != nil {
		return "", "", http.StatusInternalServerError, "db error"
	}
	defer tx.Rollback()

	err = tx.QueryRow(
		`INSERT INTO chats (is_group, is_secret, e2e_enabled, e2e_status, e2e_requested_by, e2e_requested_at)
		 VALUES (false, true, false, 'pending', $1, now())
		 RETURNING id`,
		me,
	).Scan(&chatID)
	if err != nil {
		return "", "", http.StatusInternalServerError, "failed to create secret chat"
	}

	if _, err = tx.Exec(
		`INSERT INTO chat_members (chat_id, user_id) SELECT $1, unnest($2::text[])`,
		chatID, pq.Array([]string{me, peer}),
	); err != nil {
		if isForeignKeyViolation(err) {
			return "", "", http.StatusBadRequest, "that user does not exist"
		}
		return "", "", http.StatusInternalServerError, "failed to add members"
	}

	if err = tx.Commit(); err != nil {
		return "", "", http.StatusInternalServerError, "commit failed"
	}

	notifySecretChatState(chatID, me, "e2e_request")
	return chatID, "pending", http.StatusOK, ""
}

// pendingRequester validates chat membership and that a pending request exists,
// writing an error response and returning ok=false if either check fails.
func pendingRequester(c *gin.Context, chatID, userID string) (requestedBy string, ok bool) {
	if !isChatMember(chatID, userID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a chat member"})
		return "", false
	}

	var status string
	var by sql.NullString
	if err := db.DB.QueryRow(
		`SELECT e2e_status, e2e_requested_by FROM chats WHERE id = $1`, chatID,
	).Scan(&status, &by); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "chat not found"})
		return "", false
	}
	if status != "pending" {
		c.JSON(http.StatusConflict, gin.H{"error": "no pending request for this chat"})
		return "", false
	}

	return by.String, true
}

func chatMembersList(chatID string) []string {
	rows, err := db.DB.Query(`SELECT user_id FROM chat_members WHERE chat_id = $1`, chatID)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var members []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			members = append(members, id)
		}
	}
	return members
}
