package handlers

import (
	"net/http"
	"time"

	"messenger/internal/db"
	"messenger/internal/websocket"

	"github.com/gin-gonic/gin"
)

func GetMessages(c *gin.Context) {
	chatID := c.Param("chatId")
	userID := c.GetString("user_id")

	var exists bool
	db.DB.QueryRow(
		`SELECT EXISTS (
			SELECT 1 FROM chat_members
			WHERE chat_id = $1 AND user_id = $2
		)`,
		chatID, userID,
	).Scan(&exists)

	if !exists {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a chat member"})
		return
	}

	rows, _ := db.DB.Query(
		`UPDATE messages
		 SET status = 'seen'
		 WHERE chat_id = $1
		 AND sender_id != $2
		 AND status != 'seen'
		 RETURNING id`,
		chatID, userID,
	)

	var seenIDs []int
	for rows.Next() {
		var id int
		rows.Scan(&id)
		seenIDs = append(seenIDs, id)
	}

	if len(seenIDs) > 0 {
		websocket.GlobalHub.BroadcastSeen(chatID, seenIDs)
	}

	rows2, _ := db.DB.Query(
		`SELECT id, sender_id, content, created_at, status
		 FROM messages
		 WHERE chat_id = $1
		 ORDER BY created_at ASC`,
		chatID,
	)

	type Message struct {
		ID        int       `json:"id"`
		From      string    `json:"from"`
		Content   string    `json:"content"`
		CreatedAt time.Time `json:"created_at"`
		Status    string    `json:"status"`
	}

	var messages []Message
	for rows2.Next() {
		var m Message
		rows2.Scan(&m.ID, &m.From, &m.Content, &m.CreatedAt, &m.Status)
		messages = append(messages, m)
	}

	c.JSON(http.StatusOK, messages)
}
