package websocket

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"messenger/internal/db"
	"messenger/internal/push"
	"messenger/internal/validate"
)

var GlobalHub *Hub

// MessageKey is one recipient's wrapped copy of an end-to-end encrypted
// message's content key.
type MessageKey struct {
	UserID       string `json:"user_id"`
	WrappedKey   string `json:"wrapped_key"`
	WrapIV       string `json:"wrap_iv"`
	EphemeralPub string `json:"ephemeral_pub"`
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
	MimeType  string `json:"mime_type,omitempty"`
	HasFile   bool   `json:"has_file,omitempty"`
	ReplyTo   *int   `json:"reply_to,omitempty"`

	// Encrypted payload. Content carries the ciphertext; Keys is only
	// populated on the way in, and each recipient is sent just their own.
	IsEncrypted  bool         `json:"is_encrypted,omitempty"`
	CipherIV     string       `json:"cipher_iv,omitempty"`
	Keys         []MessageKey `json:"keys,omitempty"`
	WrappedKey   string       `json:"wrapped_key,omitempty"`
	WrapIV       string       `json:"wrap_iv,omitempty"`
	EphemeralPub string       `json:"ephemeral_pub,omitempty"`
}

// Hub fans messages out to connected clients.
//
// Connections are tracked as a set per user rather than a single client. The
// previous one-client-per-user map was the cause of the "I have to restart the
// app to get messages" bug: when a phone woke from background it opened a new
// socket, and moments later the old socket's read loop finally noticed it was
// dead and unregistered — deleting the *new* connection from the map. The user
// then looked offline to the server until the whole app was restarted.
type Hub struct {
	mu      sync.RWMutex
	clients map[string]map[*Client]bool

	Incoming chan ChatMessage
}

func NewHub() *Hub {
	h := &Hub{
		clients:  make(map[string]map[*Client]bool),
		Incoming: make(chan ChatMessage, 256),
	}
	GlobalHub = h
	return h
}

func (h *Hub) Register(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.clients[c.UserID] == nil {
		h.clients[c.UserID] = make(map[*Client]bool)
	}
	h.clients[c.UserID][c] = true
}

// Unregister removes one specific connection, leaving the user's other
// sessions (a second tab, a phone and a laptop) untouched.
func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	if conns, ok := h.clients[c.UserID]; ok {
		delete(conns, c)
		if len(conns) == 0 {
			delete(h.clients, c.UserID)
		}
	}
	h.mu.Unlock()

	// Signalled outside the lock, and via the client's own done channel rather
	// than by closing Send, so concurrent fan-out cannot send on a closed
	// channel.
	c.close()
}

func (h *Hub) IsOnline(userID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients[userID]) > 0
}

// sendTo delivers to every connection a user has. Snapshotting under the read
// lock and then sending outside it keeps a slow peer from stalling the hub,
// and trySend never blocks or touches a closed channel.
func (h *Hub) sendTo(userID string, data []byte) {
	h.mu.RLock()
	conns := make([]*Client, 0, len(h.clients[userID]))
	for c := range h.clients[userID] {
		conns = append(conns, c)
	}
	h.mu.RUnlock()

	for _, c := range conns {
		c.trySend(data)
	}
}

func (h *Hub) chatMembers(chatID string) []string {
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

func (h *Hub) Run() {
	for msg := range h.Incoming {
		h.handleIncoming(msg)
	}
}

func (h *Hub) handleIncoming(msg ChatMessage) {
	// The chat id arrives from the client, so membership has to be verified
	// here. Without this any authenticated user could post into any chat by
	// sending its id over their own socket.
	if !isChatMember(msg.ChatID, msg.From) {
		return
	}
	if err := validate.MessageContent(msg.Content); err != nil {
		return
	}

	// A chat marked end-to-end encrypted must not accept cleartext, or a
	// tampered client could silently downgrade the conversation.
	var e2eEnabled bool
	if err := db.DB.QueryRow(`SELECT e2e_enabled FROM chats WHERE id = $1`, msg.ChatID).Scan(&e2eEnabled); err != nil {
		return
	}
	if e2eEnabled != msg.IsEncrypted {
		return
	}

	members := h.chatMembers(msg.ChatID)
	if len(members) == 0 {
		return
	}

	id, createdAt, err := h.persist(msg, members)
	if err != nil {
		log.Printf("websocket: failed to persist message: %v", err)
		return
	}

	out := ChatMessage{
		Type:        "message",
		ID:          id,
		ChatID:      msg.ChatID,
		From:        msg.From,
		Content:     msg.Content,
		CreatedAt:   createdAt.Format(time.RFC3339Nano),
		Status:      "sent",
		ReplyTo:     msg.ReplyTo,
		IsEncrypted: msg.IsEncrypted,
		CipherIV:    msg.CipherIV,
	}

	// If any recipient already has the chat open, mark it seen immediately.
	recipientOnline := false
	for _, userID := range members {
		if userID != msg.From && h.IsOnline(userID) {
			recipientOnline = true
			break
		}
	}
	if recipientOnline {
		if _, err := db.DB.Exec(`UPDATE messages SET status='seen' WHERE id=$1`, id); err == nil {
			out.Status = "seen"
			h.BroadcastSeen(msg.ChatID, []int{id})
		}
	}

	keysByUser := map[string]MessageKey{}
	for _, k := range msg.Keys {
		keysByUser[k.UserID] = k
	}

	for _, userID := range members {
		perUser := out
		if msg.IsEncrypted {
			k, ok := keysByUser[userID]
			if !ok {
				// No wrapped key for this member: they cannot read it, so
				// there is nothing useful to send them.
				continue
			}
			perUser.WrappedKey = k.WrappedKey
			perUser.WrapIV = k.WrapIV
			perUser.EphemeralPub = k.EphemeralPub
		}

		data, err := json.Marshal(perUser)
		if err != nil {
			continue
		}
		h.sendTo(userID, data)
	}

	h.pushToOffline(msg, members, id)
}

// persist writes the message and, for encrypted chats, one wrapped key row per
// recipient in the same transaction.
func (h *Hub) persist(msg ChatMessage, members []string) (int, time.Time, error) {
	tx, err := db.DB.Begin()
	if err != nil {
		return 0, time.Time{}, err
	}
	defer tx.Rollback()

	var id int
	var createdAt time.Time

	err = tx.QueryRow(
		`INSERT INTO messages (chat_id, sender_id, content, reply_to, is_encrypted, cipher_iv)
		 VALUES ($1, $2, $3, $4, $5, NULLIF($6,''))
		 RETURNING id, created_at`,
		msg.ChatID, msg.From, msg.Content, msg.ReplyTo, msg.IsEncrypted, msg.CipherIV,
	).Scan(&id, &createdAt)
	if err != nil {
		return 0, time.Time{}, err
	}

	if msg.IsEncrypted {
		valid := map[string]bool{}
		for _, m := range members {
			valid[m] = true
		}

		for _, k := range msg.Keys {
			if !valid[k.UserID] || k.WrappedKey == "" || k.WrapIV == "" || k.EphemeralPub == "" {
				continue
			}
			if _, err := tx.Exec(
				`INSERT INTO message_keys (message_id, user_id, wrapped_key, wrap_iv, ephemeral_pub)
				 VALUES ($1, $2, $3, $4, $5)
				 ON CONFLICT (message_id, user_id) DO NOTHING`,
				id, k.UserID, k.WrappedKey, k.WrapIV, k.EphemeralPub,
			); err != nil {
				return 0, time.Time{}, err
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, time.Time{}, err
	}
	return id, createdAt, nil
}

// pushToOffline wakes up recipients who have no live socket. Encrypted chats
// get a content-free notification, because the server genuinely cannot read
// the message.
func (h *Hub) pushToOffline(msg ChatMessage, members []string, id int) {
	if !push.Enabled() {
		return
	}

	body := msg.Content
	if msg.IsEncrypted {
		body = "🔒 New encrypted message"
	} else if len(body) > 120 {
		body = body[:120] + "…"
	}

	n := push.Notification{
		Type:   "message",
		Title:  msg.From,
		Body:   body,
		ChatID: msg.ChatID,
		From:   msg.From,
	}

	for _, userID := range members {
		if userID == msg.From || h.IsOnline(userID) {
			continue
		}
		push.SendToUser(userID, n)
	}
}

func (h *Hub) BroadcastSeen(chatID string, messageIDs []int) {
	payload, err := json.Marshal(map[string]interface{}{
		"type":        "seen",
		"chat_id":     chatID,
		"message_ids": messageIDs,
	})
	if err != nil {
		return
	}

	for _, userID := range h.chatMembers(chatID) {
		h.sendTo(userID, payload)
	}
}

func (h *Hub) BroadcastMedia(chatID string, messageID int, filename, mimeType, from, createdAt string) {
	payload, err := json.Marshal(ChatMessage{
		Type:      "message",
		ID:        messageID,
		ChatID:    chatID,
		From:      from,
		Content:   filename,
		CreatedAt: createdAt,
		Status:    "sent",
		Filename:  filename,
		MimeType:  mimeType,
		HasFile:   true,
	})
	if err != nil {
		return
	}

	for _, userID := range h.chatMembers(chatID) {
		h.sendTo(userID, payload)
	}
}

func isChatMember(chatID, userID string) bool {
	var ok bool
	err := db.DB.QueryRow(
		`SELECT EXISTS (SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2)`,
		chatID, userID,
	).Scan(&ok)
	return err == nil && ok
}
