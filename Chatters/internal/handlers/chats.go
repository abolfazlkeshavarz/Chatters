package handlers

import (
	"database/sql"
	"fmt"
	"net/http"
	"strings"
	"time"

	"messenger/internal/db"
	"messenger/internal/validate"

	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
)

const maxGroupMembers = 200

func CreateChat(c *gin.Context) {
	creator := c.GetString("user_id")

	var req struct {
		Members []string `json:"members"`
		IsGroup bool     `json:"is_group"`
		Name    string   `json:"name"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	// Build the unique member set up front so validation and limits apply to
	// what will actually be inserted.
	memberSet := map[string]struct{}{creator: {}}
	for _, m := range req.Members {
		if m = strings.TrimSpace(m); m != "" {
			memberSet[m] = struct{}{}
		}
	}

	if len(memberSet) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "at least one other member required"})
		return
	}
	if len(memberSet) > maxGroupMembers {
		c.JSON(http.StatusBadRequest, gin.H{"error": "too many members"})
		return
	}
	if !req.IsGroup && len(memberSet) != 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a direct chat must have exactly two members"})
		return
	}

	members := make([]string, 0, len(memberSet))
	for m := range memberSet {
		members = append(members, m)
	}

	name := strings.TrimSpace(req.Name)
	if len(name) > 100 {
		name = name[:100]
	}
	if req.IsGroup && name == "" {
		if len(members) > 3 {
			name = fmt.Sprintf("Group with %d members", len(members))
		} else {
			name = strings.Join(members, ", ")
		}
	}
	if !req.IsGroup {
		name = ""
	}

	tx, err := db.DB.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	defer tx.Rollback()

	var chatID string
	err = tx.QueryRow(
		`INSERT INTO chats (is_group, name) VALUES ($1, NULLIF($2,'')) RETURNING id`,
		req.IsGroup, name,
	).Scan(&chatID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create chat"})
		return
	}

	// A single statement with a foreign key does the existence check for us,
	// replacing the previous per-user SELECT-then-INSERT round trips.
	_, err = tx.Exec(
		`INSERT INTO chat_members (chat_id, user_id)
		 SELECT $1, unnest($2::text[])`,
		chatID, pq.Array(members),
	)
	if err != nil {
		if isForeignKeyViolation(err) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "one or more usernames do not exist"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to add members"})
		return
	}

	if err = tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "commit failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"chat_id": chatID})
}

type ChatResponse struct {
	ID                string    `json:"id"`
	IsGroup           bool      `json:"is_group"`
	E2EEnabled        bool      `json:"e2e_enabled"`
	E2EStatus         string    `json:"e2e_status"`
	E2ERequestedBy    *string   `json:"e2e_requested_by,omitempty"`
	Name              *string   `json:"name,omitempty"`
	Members           []string  `json:"members"`
	UnreadCount       int       `json:"unread_count"`
	LastActivity      time.Time `json:"last_activity"`
	LastMessage       *string   `json:"last_message,omitempty"`
	LastMessageTime   *string   `json:"last_message_time,omitempty"`
	LastMessageSender *string   `json:"last_message_sender,omitempty"`
	LastIsEncrypted   bool      `json:"last_is_encrypted"`
	Muted             bool      `json:"muted"`
}

func GetChats(c *gin.Context) {
	userID := c.GetString("user_id")

	rows, err := db.DB.Query(`
		WITH my_chats AS (
			SELECT chat_id FROM chat_members WHERE user_id = $1
		),
		last_msg AS (
			SELECT DISTINCT ON (chat_id)
				chat_id, content, created_at, sender_id, is_encrypted
			FROM messages
			WHERE chat_id IN (SELECT chat_id FROM my_chats)
			ORDER BY chat_id, created_at DESC, id DESC
		),
		-- Per-chat message stats are aggregated here, before the chat_members
		-- join below. Counting them alongside that join instead would multiply
		-- every message by the number of members: a two-person chat reported
		-- double the unread count, a three-person group triple it.
		stats AS (
			SELECT
				chat_id,
				COUNT(*) FILTER (
					WHERE sender_id IS DISTINCT FROM $1 AND status <> 'seen'
				) AS unread_count,
				MAX(created_at) AS last_activity
			FROM messages
			WHERE chat_id IN (SELECT chat_id FROM my_chats)
			GROUP BY chat_id
		)
		SELECT
			c.id,
			c.is_group,
			c.e2e_enabled,
			c.e2e_status,
			c.e2e_requested_by,
			c.name,
			ARRAY_AGG(DISTINCT m.user_id) AS members,
			COALESCE(s.unread_count, 0) AS unread_count,
			s.last_activity,
			lm.content,
			lm.created_at,
			lm.sender_id,
			COALESCE(lm.is_encrypted, false),
			(cmt.user_id IS NOT NULL) AS muted
		FROM chats c
		JOIN chat_members m ON m.chat_id = c.id
		LEFT JOIN stats s ON s.chat_id = c.id
		LEFT JOIN last_msg lm ON lm.chat_id = c.id
		LEFT JOIN chat_mutes cmt ON cmt.chat_id = c.id AND cmt.user_id = $1
		WHERE c.id IN (SELECT chat_id FROM my_chats)
		GROUP BY c.id, c.is_group, c.e2e_enabled, c.e2e_status, c.e2e_requested_by,
		         c.name, c.created_at, s.unread_count, s.last_activity,
		         lm.content, lm.created_at, lm.sender_id, lm.is_encrypted, cmt.user_id
		ORDER BY
			CASE WHEN COALESCE(s.unread_count, 0) > 0 THEN 0 ELSE 1 END,
			COALESCE(s.last_activity, c.created_at) DESC
	`, userID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load chats"})
		return
	}
	defer rows.Close()

	chats := []ChatResponse{}

	for rows.Next() {
		var chat ChatResponse
		var lastActivity sql.NullTime
		var lastMessageTime sql.NullTime
		var lastMessage, lastMessageSender, groupName, requestedBy sql.NullString

		if err := rows.Scan(
			&chat.ID,
			&chat.IsGroup,
			&chat.E2EEnabled,
			&chat.E2EStatus,
			&requestedBy,
			&groupName,
			pq.Array(&chat.Members),
			&chat.UnreadCount,
			&lastActivity,
			&lastMessage,
			&lastMessageTime,
			&lastMessageSender,
			&chat.LastIsEncrypted,
			&chat.Muted,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read chats"})
			return
		}

		if groupName.Valid {
			chat.Name = &groupName.String
		}
		if requestedBy.Valid {
			chat.E2ERequestedBy = &requestedBy.String
		}
		if lastActivity.Valid {
			chat.LastActivity = lastActivity.Time
		}
		if lastMessage.Valid && !chat.LastIsEncrypted {
			chat.LastMessage = &lastMessage.String
		}
		if lastMessageTime.Valid {
			s := lastMessageTime.Time.Format(time.RFC3339Nano)
			chat.LastMessageTime = &s
		}
		if lastMessageSender.Valid {
			chat.LastMessageSender = &lastMessageSender.String
		}

		chats = append(chats, chat)
	}

	c.JSON(http.StatusOK, chats)
}

// AddMember previously performed no authorisation at all: any authenticated
// user could add anybody to any chat, including chats they had no part in.
func AddMember(c *gin.Context) {
	chatID := c.Param("id")
	caller := c.GetString("user_id")

	var req struct {
		UserID string `json:"user_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	if _, err := validate.Username(req.UserID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid username"})
		return
	}

	var isGroup, e2eEnabled bool
	err := db.DB.QueryRow(
		`SELECT c.is_group, c.e2e_enabled
		 FROM chats c
		 WHERE c.id = $1
		   AND EXISTS (
		     SELECT 1 FROM chat_members cm
		     WHERE cm.chat_id = c.id AND cm.user_id = $2
		   )`,
		chatID, caller,
	).Scan(&isGroup, &e2eEnabled)

	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a chat member"})
		return
	}
	if !isGroup {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot add members to a direct chat"})
		return
	}

	var memberCount int
	_ = db.DB.QueryRow(`SELECT COUNT(*) FROM chat_members WHERE chat_id = $1`, chatID).Scan(&memberCount)
	if memberCount >= maxGroupMembers {
		c.JSON(http.StatusBadRequest, gin.H{"error": "group is full"})
		return
	}

	if e2eEnabled {
		// Without a published key the new member could not read anything, and
		// existing history stays unreadable to them regardless.
		var hasKey bool
		_ = db.DB.QueryRow(
			`SELECT public_key IS NOT NULL AND public_key <> '' FROM users WHERE id = $1`,
			req.UserID,
		).Scan(&hasKey)

		if !hasKey {
			c.JSON(http.StatusConflict, gin.H{
				"error": "that user must sign in once to publish an encryption key before joining a secure chat",
			})
			return
		}
	}

	_, err = db.DB.Exec(
		`INSERT INTO chat_members (chat_id, user_id) VALUES ($1, $2)
		 ON CONFLICT DO NOTHING`,
		chatID, req.UserID,
	)
	if err != nil {
		if isForeignKeyViolation(err) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "user does not exist"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to add member"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "member added"})
}

func GetChatMembers(c *gin.Context) {
	chatID := c.Param("id")
	userID := c.GetString("user_id")

	var isGroup, e2eEnabled bool
	var groupName sql.NullString

	err := db.DB.QueryRow(
		`SELECT c.is_group, c.name, c.e2e_enabled
		 FROM chats c
		 WHERE c.id = $1
		   AND EXISTS (
		     SELECT 1 FROM chat_members cm
		     WHERE cm.chat_id = c.id AND cm.user_id = $2
		   )`,
		chatID, userID,
	).Scan(&isGroup, &groupName, &e2eEnabled)

	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a chat member"})
		return
	}

	rows, err := db.DB.Query(`SELECT user_id FROM chat_members WHERE chat_id = $1 ORDER BY user_id`, chatID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load members"})
		return
	}
	defer rows.Close()

	members := []string{}
	for rows.Next() {
		var m string
		if err := rows.Scan(&m); err == nil {
			members = append(members, m)
		}
	}

	var name *string
	if groupName.Valid {
		name = &groupName.String
	}

	c.JSON(http.StatusOK, gin.H{
		"is_group":    isGroup,
		"group_name":  name,
		"e2e_enabled": e2eEnabled,
		"members":     members,
	})
}
