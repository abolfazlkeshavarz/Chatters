package handlers

import (
	"database/sql"
	"net/http"
	"strconv"
	"time"

	"messenger/internal/db"
	"messenger/internal/websocket"

	"github.com/gin-gonic/gin"
)

const defaultMessageLimit = 200

type Message struct {
	ID        int       `json:"id"`
	From      string    `json:"from"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
	Status    string    `json:"status"`
	ReplyTo   *int      `json:"reply_to"`
	Type      string    `json:"type"`
	HasFile   bool      `json:"has_file"`
	Filename  *string   `json:"filename,omitempty"`
	MimeType  *string   `json:"mime_type,omitempty"`

	// End-to-end encrypted payload. Content holds the ciphertext and the
	// caller's own wrapped copy of the message key travels alongside it.
	IsEncrypted  bool    `json:"is_encrypted"`
	CipherIV     *string `json:"cipher_iv,omitempty"`
	WrappedKey   *string `json:"wrapped_key,omitempty"`
	WrapIV       *string `json:"wrap_iv,omitempty"`
	EphemeralPub *string `json:"ephemeral_pub,omitempty"`
}

func GetMessages(c *gin.Context) {
	chatID := c.Param("id")
	userID := c.GetString("user_id")

	if !isChatMember(chatID, userID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a chat member"})
		return
	}

	limit := defaultMessageLimit
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 && v <= 500 {
		limit = v
	}

	// Mark the other side's messages as seen, and tell everyone which ones.
	rows, err := db.DB.Query(
		`UPDATE messages
		 SET status = 'seen'
		 WHERE chat_id = $1 AND sender_id IS DISTINCT FROM $2 AND status <> 'seen'
		 RETURNING id`,
		chatID, userID,
	)
	if err == nil {
		var seenIDs []int
		for rows.Next() {
			var id int
			if rows.Scan(&id) == nil {
				seenIDs = append(seenIDs, id)
			}
		}
		rows.Close()

		if len(seenIDs) > 0 {
			websocket.GlobalHub.BroadcastSeen(chatID, seenIDs)
		}
	}

	// The caller's own wrapped key is joined in, so a client never sees key
	// material belonging to anyone else.
	msgRows, err := db.DB.Query(
		`SELECT m.id, COALESCE(m.sender_id, '[deleted]'), COALESCE(m.content, ''),
		        m.created_at, m.status, m.reply_to, m.type,
		        m.file_path IS NOT NULL, m.filename, m.mime_type,
		        m.is_encrypted, m.cipher_iv,
		        mk.wrapped_key, mk.wrap_iv, mk.ephemeral_pub
		 FROM messages m
		 LEFT JOIN message_keys mk ON mk.message_id = m.id AND mk.user_id = $2
		 WHERE m.chat_id = $1
		 ORDER BY m.created_at DESC, m.id DESC
		 LIMIT $3`,
		chatID, userID, limit,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load messages"})
		return
	}
	defer msgRows.Close()

	messages := []Message{}
	for msgRows.Next() {
		var m Message
		var cipherIV, wrappedKey, wrapIV, ephPub, filename, mimeType sql.NullString

		if err := msgRows.Scan(
			&m.ID, &m.From, &m.Content, &m.CreatedAt, &m.Status, &m.ReplyTo, &m.Type,
			&m.HasFile, &filename, &mimeType,
			&m.IsEncrypted, &cipherIV,
			&wrappedKey, &wrapIV, &ephPub,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read messages"})
			return
		}

		m.Filename = nullStr(filename)
		m.MimeType = nullStr(mimeType)
		m.CipherIV = nullStr(cipherIV)
		m.WrappedKey = nullStr(wrappedKey)
		m.WrapIV = nullStr(wrapIV)
		m.EphemeralPub = nullStr(ephPub)

		messages = append(messages, m)
	}

	// Queried newest-first so LIMIT keeps the most recent window; the UI wants
	// them oldest-first.
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}

	c.JSON(http.StatusOK, messages)
}

func nullStr(s sql.NullString) *string {
	if !s.Valid {
		return nil
	}
	v := s.String
	return &v
}
