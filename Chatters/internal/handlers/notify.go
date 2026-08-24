package handlers

import (
	"messenger/internal/db"
	"messenger/internal/push"
)

// notifyChat pushes a notification to every member of a chat except the
// sender. Delivery is best-effort and must never block or fail the request
// that triggered it.
func notifyChat(chatID, sender string, n push.Notification) {
	if !push.Enabled() {
		return
	}

	go func() {
		rows, err := db.DB.Query(
			`SELECT user_id FROM chat_members WHERE chat_id = $1 AND user_id <> $2`,
			chatID, sender,
		)
		if err != nil {
			return
		}
		defer rows.Close()

		for rows.Next() {
			var userID string
			if rows.Scan(&userID) == nil {
				push.SendToUser(userID, n)
			}
		}
	}()
}
