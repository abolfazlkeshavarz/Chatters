package websocket

import (
	"encoding/json"

	"messenger/internal/db"
)

var GlobalHub *Hub

type Hub struct {
	Clients    map[string]*Client
	Register   chan *Client
	Unregister chan *Client
	Incoming   chan ChatMessage
}

type ChatMessage struct {
	Type      string `json:"type"`
	ID        int    `json:"id"`
	ChatID    string `json:"chat_id"`
	From      string `json:"from"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
	Status    string `json:"status"`
	Filename  string `json:"filename,omitempty"`
	ReplyTo   *int   `json:"reply_to,omitempty"`
}

func NewHub() *Hub {
	h := &Hub{
		Clients:    make(map[string]*Client),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
		Incoming:   make(chan ChatMessage),
	}
	GlobalHub = h
	return h
}

func (h *Hub) getChatMembers(chatID string) ([]string, error) {
	rows, err := db.DB.Query(
		`SELECT user_id FROM chat_members WHERE chat_id = $1`,
		chatID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var members []string
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		members = append(members, id)
	}
	return members, nil
}

func (h *Hub) Run() {
	for {
		select {

		case c := <-h.Register:
			h.Clients[c.UserID] = c

		case c := <-h.Unregister:
			delete(h.Clients, c.UserID)
			close(c.Send)

		case msg := <-h.Incoming:

			var id int
			var createdAt string

			err := db.DB.QueryRow(
				`INSERT INTO messages (chat_id, sender_id, content, reply_to)
				VALUES ($1, $2, $3, $4)
				RETURNING id, created_at`,
				msg.ChatID, msg.From, msg.Content, msg.ReplyTo,
			).Scan(&id, &createdAt)

			if err != nil {
				continue
			}

			out := ChatMessage{
				Type:      "message",
				ID:        id,
				ChatID:    msg.ChatID,
				From:      msg.From,
				Content:   msg.Content,
				CreatedAt: createdAt,
				Status:    "sent",
				ReplyTo:   msg.ReplyTo,
			}

			members, _ := h.getChatMembers(msg.ChatID)

			for _, userID := range members {
				if userID == msg.From {
					continue
				}

				if _, ok := h.Clients[userID]; ok {
					// recipient is online → mark seen immediately
					db.DB.Exec(
						`UPDATE messages SET status='seen' WHERE id=$1`,
						id,
					)

					h.BroadcastSeen(msg.ChatID, []int{id})

					out.Status = "seen"
				}
			}


			data, _ := json.Marshal(out)

			for _, userID := range members {
				if client, ok := h.Clients[userID]; ok {
					client.Send <- data
				}
			}

		}
	}
}

func (h *Hub) BroadcastSeen(chatID string, messageIDs []int) {
	payload, _ := json.Marshal(map[string]interface{}{
		"type":        "seen",
		"chat_id":     chatID,
		"message_ids": messageIDs,
	})

	members, _ := h.getChatMembers(chatID)

	for _, userID := range members {
		if client, ok := h.Clients[userID]; ok {
			client.Send <- payload
		}
	}
}


func (h *Hub) BroadcastMedia(
    chatID string,
    messageID int,
    filename string,
    from string,
    createdAt string,
) {
    // Create proper media message payload
    payload, _ := json.Marshal(map[string]interface{}{
        "type":       "message",  // Changed from "media" to "message" for consistency
        "id":         messageID,
        "chat_id":    chatID,
        "from":       from,
        "content":    filename,
        "created_at": createdAt,
        "status":     "sent",
        "filename":   filename,
        "mime_type":  "application/octet-stream", // You might want to store this properly
    })

    members, _ := h.getChatMembers(chatID)

    for _, userID := range members {
        if client, ok := h.Clients[userID]; ok {
            client.Send <- payload
        }
    }
}
