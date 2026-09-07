package handlers

import (
	"fmt"
	"net/http"
	"time"

	"messenger/internal/db"
	"messenger/internal/push"
	"messenger/internal/validate"
	"messenger/internal/websocket"

	"github.com/gin-gonic/gin"
)

// allowedSelfDestruct is the fixed menu of self-destruct durations, in seconds.
// 0 means the timer is off. Kept small and identical on both clients so the
// picker is a simple list rather than a free-form field.
var allowedSelfDestruct = map[int]string{
	0:      "off",
	5:      "5 seconds",
	30:     "30 seconds",
	60:     "1 minute",
	3600:   "1 hour",
	86400:  "1 day",
	604800: "1 week",
}

func selfDestructLabel(seconds int) string {
	if l, ok := allowedSelfDestruct[seconds]; ok {
		return l
	}
	return fmt.Sprintf("%d seconds", seconds)
}

// CreateSecretChat starts (or returns) a Telegram-style secret chat with one
// other user: its own pending 1:1 chat row, visible to both sides, which the
// other user accepts or rejects.
func CreateSecretChat(c *gin.Context) {
	me := c.GetString("user_id")

	var req struct {
		UserID string `json:"user_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	peer, err := validate.Username(req.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid username"})
		return
	}

	chatID, status, code, errMsg := startSecretChat(me, peer)
	if errMsg != "" {
		c.JSON(code, gin.H{"error": errMsg})
		return
	}
	c.JSON(http.StatusOK, gin.H{"chat_id": chatID, "status": status})
}

// SetSelfDestruct changes a secret chat's message timer. Either member may do
// it; it applies to messages sent afterwards. A 'system' message records the
// change in the transcript and every open client is told live.
func SetSelfDestruct(c *gin.Context) {
	chatID := c.Param("id")
	me := c.GetString("user_id")

	var req struct {
		Seconds int `json:"seconds"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	if _, ok := allowedSelfDestruct[req.Seconds]; !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported timer value"})
		return
	}

	var isSecret bool
	if err := db.DB.QueryRow(
		`SELECT c.is_secret FROM chats c
		 WHERE c.id = $1 AND EXISTS (
		   SELECT 1 FROM chat_members cm WHERE cm.chat_id = c.id AND cm.user_id = $2
		 )`,
		chatID, me,
	).Scan(&isSecret); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a chat member"})
		return
	}
	if !isSecret {
		c.JSON(http.StatusBadRequest, gin.H{"error": "the self-destruct timer is only available in secret chats"})
		return
	}

	if _, err := db.DB.Exec(
		`UPDATE chats SET self_destruct_seconds = $1 WHERE id = $2`, req.Seconds, chatID,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update timer"})
		return
	}

	var note string
	if req.Seconds == 0 {
		note = fmt.Sprintf("%s turned the self-destruct timer off", me)
	} else {
		note = fmt.Sprintf("%s set messages to self-destruct %s after sending", me, selfDestructLabel(req.Seconds))
	}
	sysID, sysCreated := insertSystemMessage(chatID, note)

	if websocket.GlobalHub != nil {
		websocket.GlobalHub.BroadcastEvent(chatID, map[string]interface{}{
			"type":    "timer",
			"chat_id": chatID,
			"seconds": req.Seconds,
			"by":      me,
		})
		if sysID > 0 {
			websocket.GlobalHub.BroadcastEvent(chatID, map[string]interface{}{
				"type":       "message",
				"id":         sysID,
				"chat_id":    chatID,
				"from":       "",
				"content":    note,
				"created_at": sysCreated.Format(time.RFC3339Nano),
				"is_system":  true,
				"status":     "seen",
			})
		}
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok", "seconds": req.Seconds})
}

// insertSystemMessage writes a sender-less notice into a chat's transcript.
func insertSystemMessage(chatID, content string) (int, time.Time) {
	var id int
	var created time.Time
	err := db.DB.QueryRow(
		`INSERT INTO messages (chat_id, sender_id, content, type, status)
		 VALUES ($1, NULL, $2, 'system', 'seen')
		 RETURNING id, created_at`,
		chatID, content,
	).Scan(&id, &created)
	if err != nil {
		return 0, time.Time{}
	}
	return id, created
}

// notifySecretChatState pushes the secret-chat lifecycle (request / accept /
// reject) over the live socket to both members, and wakes an offline recipient
// for the initial request.
func notifySecretChatState(chatID, actor, eventType string) {
	if websocket.GlobalHub == nil {
		return
	}
	websocket.GlobalHub.BroadcastEvent(chatID, map[string]interface{}{
		"type":    eventType,
		"chat_id": chatID,
		"by":      actor,
	})

	if eventType != "e2e_request" || !push.Active() {
		return
	}
	for _, userID := range chatMembersList(chatID) {
		if userID == actor || websocket.GlobalHub.IsOnline(userID) {
			continue
		}
		push.Notify(userID, push.Notification{
			Type:   "e2e_request",
			Title:  actor,
			Body:   "wants to start a secret chat",
			ChatID: chatID,
			From:   actor,
		})
	}
}
