package handlers

import (
	"database/sql"
	"net/http"
	"os"
	"strconv"
	"time"

	"messenger/internal/db"
	"messenger/internal/websocket"

	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
)

type adminChat struct {
	ID                  string     `json:"id"`
	IsGroup             bool       `json:"is_group"`
	IsSecret            bool       `json:"is_secret"`
	E2EEnabled          bool       `json:"e2e_enabled"`
	E2EStatus           string     `json:"e2e_status"`
	SelfDestructSeconds int        `json:"self_destruct_seconds"`
	Name                *string    `json:"name,omitempty"`
	Members             []string   `json:"members"`
	MessageCount        int        `json:"message_count"`
	CreatedAt           time.Time  `json:"created_at"`
	LastActivity        *time.Time `json:"last_activity,omitempty"`

	// A chat a user deleted "for everyone" is retained for moderation rather
	// than destroyed, so the panel has to be able to tell the two apart.
	DeletedAt   *time.Time `json:"deleted_at,omitempty"`
	DeletedBy   *string    `json:"deleted_by,omitempty"`
	DeletedMsgs int        `json:"deleted_message_count"`
}

// AdminListChats returns every chat in the system, newest activity first,
// optionally filtered by chat id, group name, or a member's username.
func AdminListChats(c *gin.Context) {
	search := "%" + c.Query("search") + "%"

	limit := 50
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 && v <= 200 {
		limit = v
	}
	offset := 0
	if v, err := strconv.Atoi(c.Query("offset")); err == nil && v > 0 {
		offset = v
	}

	// "all" by default: a moderator opening this list wants to see everything
	// that exists, including what users removed — that retention is the reason
	// the rows are still here.
	state := c.DefaultQuery("state", "all")
	if state != "all" && state != "live" && state != "deleted" {
		state = "all"
	}

	// A LEFT JOIN plus the member snapshot, not an inner JOIN on chat_members:
	// deleting a chat for everyone clears its membership rows, so an inner join
	// would hide from the panel exactly the conversations it is retained for.
	rows, err := db.DB.Query(
		`SELECT c.id, c.is_group, c.is_secret, c.e2e_enabled, c.e2e_status,
		        c.self_destruct_seconds, c.name, c.created_at,
		        c.deleted_at, c.deleted_by,
		        COALESCE(
		          ARRAY_AGG(DISTINCT cm.user_id) FILTER (WHERE cm.user_id IS NOT NULL),
		          ARRAY(SELECT h.user_id FROM chat_member_history h WHERE h.chat_id = c.id),
		          '{}'
		        ) AS members,
		        (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS message_count,
		        (SELECT COUNT(*) FROM messages m
		          WHERE m.chat_id = c.id AND m.deleted_at IS NOT NULL) AS deleted_message_count,
		        (SELECT MAX(m.created_at) FROM messages m WHERE m.chat_id = c.id) AS last_activity
		 FROM chats c
		 LEFT JOIN chat_members cm ON cm.chat_id = c.id
		 WHERE ($4 = 'all'
		        OR ($4 = 'deleted' AND c.deleted_at IS NOT NULL)
		        OR ($4 = 'live' AND c.deleted_at IS NULL))
		   AND (c.id::text ILIKE $1
		        OR COALESCE(c.name, '') ILIKE $1
		        OR EXISTS (SELECT 1 FROM chat_members x WHERE x.chat_id = c.id AND x.user_id ILIKE $1)
		        OR EXISTS (SELECT 1 FROM chat_member_history h WHERE h.chat_id = c.id AND h.user_id ILIKE $1))
		 GROUP BY c.id
		 ORDER BY last_activity DESC NULLS LAST, c.created_at DESC
		 LIMIT $2 OFFSET $3`,
		search, limit, offset, state,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list chats"})
		return
	}
	defer rows.Close()

	chats := []adminChat{}
	for rows.Next() {
		var ch adminChat
		var name, deletedBy sql.NullString
		var lastActivity, deletedAt sql.NullTime
		if err := rows.Scan(
			&ch.ID, &ch.IsGroup, &ch.IsSecret, &ch.E2EEnabled, &ch.E2EStatus,
			&ch.SelfDestructSeconds, &name, &ch.CreatedAt,
			&deletedAt, &deletedBy,
			pq.Array(&ch.Members), &ch.MessageCount, &ch.DeletedMsgs, &lastActivity,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read chats"})
			return
		}
		if name.Valid {
			ch.Name = &name.String
		}
		if lastActivity.Valid {
			ch.LastActivity = &lastActivity.Time
		}
		if deletedAt.Valid {
			ch.DeletedAt = &deletedAt.Time
		}
		ch.DeletedBy = nullStr(deletedBy)
		chats = append(chats, ch)
	}

	var total, deleted int
	_ = db.DB.QueryRow(`SELECT COUNT(*) FROM chats`).Scan(&total)
	_ = db.DB.QueryRow(`SELECT COUNT(*) FROM chats WHERE deleted_at IS NOT NULL`).Scan(&deleted)

	c.JSON(http.StatusOK, gin.H{"chats": chats, "total": total, "deleted": deleted})
}

type adminMessage struct {
	ID          int        `json:"id"`
	From        string     `json:"from"`
	Content     string     `json:"content"`
	Type        string     `json:"type"`
	IsEncrypted bool       `json:"is_encrypted"`
	HasFile     bool       `json:"has_file"`
	Filename    *string    `json:"filename,omitempty"`
	MimeType    *string    `json:"mime_type,omitempty"`
	SizeBytes   *int64     `json:"size_bytes,omitempty"`
	Status      string     `json:"status"`
	CreatedAt   time.Time  `json:"created_at"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
	DeletedAt   *time.Time `json:"deleted_at,omitempty"`
	DeletedBy   *string    `json:"deleted_by,omitempty"`
}

// AdminGetChatMessages returns a chat's full transcript for the moderator
// view. Per-user "delete for me" tombstones are ignored — an admin sees
// everything that still physically exists. Encrypted message bodies are
// returned as the stored ciphertext and flagged; the server cannot decrypt
// them.
func AdminGetChatMessages(c *gin.Context) {
	chatID := c.Param("id")

	limit := 100
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 && v <= 500 {
		limit = v
	}
	offset := 0
	if v, err := strconv.Atoi(c.Query("offset")); err == nil && v > 0 {
		offset = v
	}

	rows, err := db.DB.Query(
		`SELECT m.id,
		        COALESCE(m.sender_id, CASE WHEN m.type = 'system' THEN '' ELSE '[deleted]' END),
		        COALESCE(m.content, ''), m.type, m.is_encrypted,
		        m.file_path IS NOT NULL, m.filename, m.mime_type,
		        m.status, m.created_at, m.expires_at, m.deleted_at, m.deleted_by
		 FROM messages m
		 WHERE m.chat_id = $1
		 ORDER BY m.id DESC
		 LIMIT $2 OFFSET $3`,
		chatID, limit, offset,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load messages"})
		return
	}
	defer rows.Close()

	out := []adminMessage{}
	for rows.Next() {
		var m adminMessage
		var filename, mimeType, deletedBy sql.NullString
		var expiresAt, deletedAt sql.NullTime
		if err := rows.Scan(
			&m.ID, &m.From, &m.Content, &m.Type, &m.IsEncrypted,
			&m.HasFile, &filename, &mimeType, &m.Status, &m.CreatedAt, &expiresAt,
			&deletedAt, &deletedBy,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read messages"})
			return
		}
		m.Filename = nullStr(filename)
		m.MimeType = nullStr(mimeType)
		m.DeletedBy = nullStr(deletedBy)
		if expiresAt.Valid {
			m.ExpiresAt = &expiresAt.Time
		}
		if deletedAt.Valid {
			m.DeletedAt = &deletedAt.Time
		}
		out = append(out, m)
	}

	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}

	var total int
	_ = db.DB.QueryRow(`SELECT COUNT(*) FROM messages WHERE chat_id = $1`, chatID).Scan(&total)

	c.JSON(http.StatusOK, gin.H{"messages": out, "total": total})
}

// AdminDeleteChat removes a chat and everything in it, for all members.
func AdminDeleteChat(c *gin.Context) {
	chatID := c.Param("id")

	members := chatMembersList(chatID)

	var filePaths []string
	rows, err := db.DB.Query(
		`SELECT file_path FROM messages WHERE chat_id = $1 AND file_path IS NOT NULL`, chatID,
	)
	if err == nil {
		for rows.Next() {
			var p sql.NullString
			if rows.Scan(&p) == nil && p.Valid {
				filePaths = append(filePaths, p.String)
			}
		}
		rows.Close()
	}

	res, err := db.DB.Exec(`DELETE FROM chats WHERE id = $1`, chatID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete chat"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "chat not found"})
		return
	}

	for _, p := range filePaths {
		if withinUploadDir(p) {
			_ = os.Remove(p)
		}
	}
	removeChatUploads(chatID)

	if websocket.GlobalHub != nil && len(members) > 0 {
		websocket.GlobalHub.BroadcastEventToMembers(members, map[string]interface{}{
			"type":    "chat_deleted",
			"chat_id": chatID,
		})
	}

	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

// AdminDeleteMessage hard-deletes one message for everyone.
func AdminDeleteMessage(c *gin.Context) {
	msgID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid message id"})
		return
	}

	var chatID string
	var filePath sql.NullString
	if err := db.DB.QueryRow(
		`SELECT chat_id, file_path FROM messages WHERE id = $1`, msgID,
	).Scan(&chatID, &filePath); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "message not found"})
		return
	}

	if _, err := db.DB.Exec(`DELETE FROM messages WHERE id = $1`, msgID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete message"})
		return
	}
	if filePath.Valid && filePath.String != "" && withinUploadDir(filePath.String) {
		_ = os.Remove(filePath.String)
	}

	if websocket.GlobalHub != nil {
		websocket.GlobalHub.BroadcastEvent(chatID, map[string]interface{}{
			"type":    "deleted",
			"chat_id": chatID,
			"ids":     []int{msgID},
		})
	}

	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}
