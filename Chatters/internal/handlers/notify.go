package handlers

import (
	"database/sql"

	"messenger/internal/db"
	"messenger/internal/push"
	"messenger/internal/websocket"
)

// groupNotificationTitle returns what a push notification for chatID should
// use as its title and how the sender should be woven into the body — the
// group's name for a group chat (so someone in several groups with the same
// person can tell them apart), or the sender's own name for a direct chat
// (there being only the one person it could be). Same convention as
// websocket.Hub.pushToOffline uses for plain messages; this is the media/
// attachment-upload equivalent.
func groupNotificationTitle(chatID, sender string) (title string, prefixSender bool) {
	var isGroup bool
	var name sql.NullString
	if err := db.DB.QueryRow(`SELECT is_group, name FROM chats WHERE id = $1`, chatID).Scan(&isGroup, &name); err != nil {
		return sender, false
	}
	if !isGroup {
		return sender, false
	}
	if name.Valid && name.String != "" {
		return name.String, true
	}
	return "Group chat", true
}

// notifyChat pushes a notification to every member of a chat except the
// sender — skipping anyone who already has the message live (they are
// connected, so the WebSocket broadcast already reached them) or who has
// muted the chat. Delivery is best-effort and must never block or fail the
// request that triggered it.
//
// This mirrors websocket.Hub.pushToOffline, which is the same logic for
// plain chat messages. It used to be duplicated here without the online/mute
// checks — found while auditing notification paths — which meant muting a
// chat silenced ordinary messages but not attachment uploads, the one other
// caller of this function.
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

		var members []string
		for rows.Next() {
			var userID string
			if rows.Scan(&userID) == nil {
				members = append(members, userID)
			}
		}
		rows.Close()

		for _, userID := range members {
			if websocket.GlobalHub != nil && websocket.GlobalHub.IsOnline(userID) {
				continue
			}
			if db.IsChatMuted(chatID, userID) {
				continue
			}
			push.SendToUser(userID, n)
		}
	}()
}
