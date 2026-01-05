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
				`INSERT INTO messages (chat_id, sender_id, content)
				 VALUES ($1, $2, $3)
				 RETURNING id, created_at`,
				msg.ChatID, msg.From, msg.Content,
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
			}

			data, _ := json.Marshal(out)
			members, _ := h.getChatMembers(msg.ChatID)

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
	mediaID int,
	filename string,
	from string,
	createdAt string,
) {
	payload, _ := json.Marshal(ChatMessage{
		Type:      "media",
		ID:        mediaID,
		ChatID:    chatID,
		From:      from,
		Filename:  filename,
		CreatedAt: createdAt,
	})

	members, _ := h.getChatMembers(chatID)

	for _, userID := range members {
		if client, ok := h.Clients[userID]; ok {
			client.Send <- payload
		}
	}
}
