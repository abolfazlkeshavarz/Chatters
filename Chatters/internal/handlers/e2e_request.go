package handlers

import (
	"database/sql"
	"net/http"

	"messenger/internal/db"
	"messenger/internal/push"
	"messenger/internal/websocket"

	"github.com/gin-gonic/gin"
)

// RequestChatE2E starts the consent handshake for turning a chat into an
// end-to-end encrypted one. It no longer flips encryption on by itself — that
// used to let either member silently upgrade a conversation the other side
// never agreed to. Now it only records that a request is pending and notifies
// the other member(s), who must explicitly accept.
func RequestChatE2E(c *gin.Context) {
	chatID := c.Param("id")
	userID := c.GetString("user_id")

	if !isChatMember(chatID, userID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a chat member"})
		return
	}

	var status string
	var enabled bool
	if err := db.DB.QueryRow(
		`SELECT e2e_status, e2e_enabled FROM chats WHERE id = $1`, chatID,
	).Scan(&status, &enabled); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "chat not found"})
		return
	}
	if enabled || status == "accepted" {
		c.JSON(http.StatusConflict, gin.H{"error": "this chat is already encrypted"})
		return
	}
	if status == "pending" {
		c.JSON(http.StatusConflict, gin.H{"error": "a request is already pending"})
		return
	}

	// Every member needs a published public key or some of them would be
	// unable to read anything sent after acceptance.
	if without, err := membersWithoutKeys(chatID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to verify member keys"})
		return
	} else if without > 0 {
		c.JSON(http.StatusConflict, gin.H{
			"error": "every member must sign in once to publish an encryption key before this chat can be secured",
		})
		return
	}

	res, err := db.DB.Exec(
		`UPDATE chats SET e2e_status = 'pending', e2e_requested_by = $1, e2e_requested_at = now()
		 WHERE id = $2 AND e2e_status = 'none'`,
		userID, chatID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to request encryption"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "a request is already pending"})
		return
	}

	notifyE2EState(chatID, userID, "e2e_request")
	c.JSON(http.StatusOK, gin.H{"status": "pending"})
}

// AcceptChatE2E completes the handshake: only a member who did not send the
// request may accept it, which is what makes this consent rather than a
// second way to trigger the same unilateral switch.
func AcceptChatE2E(c *gin.Context) {
	chatID := c.Param("id")
	userID := c.GetString("user_id")

	requestedBy, ok := pendingRequester(c, chatID, userID)
	if !ok {
		return
	}
	if requestedBy == userID {
		c.JSON(http.StatusConflict, gin.H{"error": "you cannot accept your own request"})
		return
	}

	if without, err := membersWithoutKeys(chatID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to verify member keys"})
		return
	} else if without > 0 {
		c.JSON(http.StatusConflict, gin.H{
			"error": "every member must sign in once to publish an encryption key before this chat can be secured",
		})
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

	notifyE2EState(chatID, userID, "e2e_accepted")
	c.JSON(http.StatusOK, gin.H{"status": "ok", "e2e_enabled": true})
}

// RejectChatE2E cancels a pending request. The chat reverts to normal, and can
// be requested again later.
func RejectChatE2E(c *gin.Context) {
	chatID := c.Param("id")
	userID := c.GetString("user_id")

	requestedBy, ok := pendingRequester(c, chatID, userID)
	if !ok {
		return
	}
	if requestedBy == userID {
		c.JSON(http.StatusConflict, gin.H{"error": "you cannot reject your own request; it will simply expire unanswered"})
		return
	}

	if _, err := db.DB.Exec(
		`UPDATE chats SET e2e_status = 'none', e2e_requested_by = NULL, e2e_requested_at = NULL
		 WHERE id = $1 AND e2e_status = 'pending'`,
		chatID,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reject request"})
		return
	}

	notifyE2EState(chatID, userID, "e2e_rejected")
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// pendingRequester validates chat membership and a pending request, writing
// an error response and returning ok=false if either check fails.
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

func membersWithoutKeys(chatID string) (int, error) {
	var n int
	err := db.DB.QueryRow(
		`SELECT COUNT(*)
		 FROM chat_members cm
		 JOIN users u ON u.id = cm.user_id
		 WHERE cm.chat_id = $1 AND (u.public_key IS NULL OR u.public_key = '')`,
		chatID,
	).Scan(&n)
	return n, err
}

// notifyE2EState pushes the state change over the live socket to every member
// (including the actor, so their other open tabs/devices update too) and, for
// the request itself, wakes up an offline recipient. Acceptance and rejection
// are not pushed to offline devices — they will see the current state next
// time they open the chat, and a push notification would arrive after the
// action is already resolved.
func notifyE2EState(chatID, actor, eventType string) {
	if websocket.GlobalHub == nil {
		return
	}

	websocket.GlobalHub.BroadcastEvent(chatID, map[string]interface{}{
		"type":    eventType,
		"chat_id": chatID,
		"by":      actor,
	})

	if eventType != "e2e_request" || !push.Enabled() {
		return
	}

	members := chatMembersList(chatID)
	for _, userID := range members {
		if userID == actor || websocket.GlobalHub.IsOnline(userID) {
			continue
		}
		// An E2E request needs a decision, so unlike a muted chat's regular
		// messages it is always pushed.
		push.SendToUser(userID, push.Notification{
			Type:   "e2e_request",
			Title:  actor,
			Body:   "wants to start an end-to-end encrypted chat",
			ChatID: chatID,
			From:   actor,
		})
	}
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
