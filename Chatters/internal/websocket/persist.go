package websocket

import (
	"messenger/internal/db"

	"github.com/google/uuid"
)

func saveMessage(msg ChatMessage) {
	db.DB.Exec(
		`INSERT INTO messages (id, chat_id, sender_id, content)
		 VALUES ($1, $2, $3, $4)`,
		uuid.New(),
		msg.ChatID,
		msg.From,
		msg.Content,
	)
}
