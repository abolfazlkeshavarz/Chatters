package handlers

import (
	"net/http"

	"messenger/internal/db"

	"github.com/gin-gonic/gin"
)

// SetChatMute mutes or unmutes push/in-app notifications for one chat, for
// the caller only. Messages still arrive and count as unread normally — this
// only silences the notification.
func SetChatMute(c *gin.Context) {
	chatID := c.Param("id")
	userID := c.GetString("user_id")

	if !isChatMember(chatID, userID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a chat member"})
		return
	}

	var req struct {
		Muted bool `json:"muted"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	var err error
	if req.Muted {
		_, err = db.DB.Exec(
			`INSERT INTO chat_mutes (chat_id, user_id) VALUES ($1, $2)
			 ON CONFLICT (chat_id, user_id) DO NOTHING`,
			chatID, userID,
		)
	} else {
		_, err = db.DB.Exec(`DELETE FROM chat_mutes WHERE chat_id = $1 AND user_id = $2`, chatID, userID)
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update mute state"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok", "muted": req.Muted})
}
