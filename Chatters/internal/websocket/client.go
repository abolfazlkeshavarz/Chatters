package websocket

import (
	"github.com/gorilla/websocket"
	"messenger/internal/db"
	"encoding/json"
)

type Client struct {
	UserID string
	Conn   *websocket.Conn
	Send   chan []byte
}

func readPump(hub *Hub, client *Client) {
	defer func() {
		hub.Unregister <- client
		client.Conn.Close()
	}()

	for {
		_, message, err := client.Conn.ReadMessage()
		if err != nil {
			break
		}

		var msg ChatMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			continue
		}

		// 🔴 HANDLE "SEEN" EVENT HERE
		if msg.Type == "seen" {
			rows, _ := db.DB.Query(
				`UPDATE messages
				 SET status = 'seen'
				 WHERE chat_id = $1
				 AND sender_id != $2
				 AND status != 'seen'
				 RETURNING id`,
				msg.ChatID, client.UserID,
			)

			var seenIDs []int
			for rows.Next() {
				var id int
				rows.Scan(&id)
				seenIDs = append(seenIDs, id)
			}

			if len(seenIDs) > 0 {
				hub.BroadcastSeen(msg.ChatID, seenIDs)
			}

			continue // ⬅️ IMPORTANT: do NOT treat as chat message
		}

		// 🟢 NORMAL CHAT MESSAGE
		msg.From = client.UserID
		hub.Incoming <- msg
	}
}

func writePump(client *Client) {
	defer client.Conn.Close()

	for msg := range client.Send {
		err := client.Conn.WriteMessage(websocket.TextMessage, msg)
		if err != nil {
			return
		}
	}
}
