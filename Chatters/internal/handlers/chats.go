package handlers

import (
	"net/http"
	"database/sql"
	"time"
	"github.com/lib/pq"
	"messenger/internal/db"
	"github.com/gin-gonic/gin"
	"fmt"
	"strings"
)

func CreateChat(c *gin.Context) {
	creator := c.GetString("user_id")

	var req struct {
		Members []string `json:"members"`
		IsGroup bool     `json:"is_group"`
		Name    string   `json:"name"` // Add group name field
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		println("DB ERROR:", err.Error())
		c.JSON(400, gin.H{"error": "invalid request"})
		return
	}

	// For groups, require a name if provided
	if req.IsGroup && req.Name == "" {
		// Generate default name: Group with members (truncated)
		memberCount := len(req.Members) + 1 // +1 for creator
		if memberCount > 3 {
			req.Name = fmt.Sprintf("Group with %d members", memberCount)
		} else {
			// Include creator in name generation
			allMembers := append([]string{creator}, req.Members...)
			if len(allMembers) > 3 {
				req.Name = "Group with " + strings.Join(allMembers[:3], ", ") + "..."
			} else {
				req.Name = strings.Join(allMembers, ", ")
			}
		}
	}

	if len(req.Members) < 1 {
		c.JSON(400, gin.H{"error": "at least one member required"})
		return
	}

	tx, err := db.DB.Begin()
	if err != nil {
		println("DB ERROR:", err.Error())
		c.JSON(500, gin.H{"error": "db error"})
		return
	}
	defer tx.Rollback()

	// 1️⃣ Create chat with name
	var chatID string
	err = tx.QueryRow(
		`INSERT INTO chats (is_group, name)
		 VALUES ($1, $2)
		 RETURNING id`,
		req.IsGroup,
		req.Name,
	).Scan(&chatID)
	if err != nil {
		println("DB ERROR:", err.Error())
		c.JSON(500, gin.H{"error": "failed to create chat"})
		return
	}

	// 2️⃣ Build UNIQUE member set
	memberSet := map[string]bool{}
	memberSet[creator] = true

	for _, m := range req.Members {
		memberSet[m] = true
	}

	// 3️⃣ Validate users & insert members
	for user := range memberSet {

		// check user exists
		var exists bool
		err = tx.QueryRow(
			`SELECT EXISTS (SELECT 1 FROM users WHERE id = $1)`,
			user,
		).Scan(&exists)

		if err != nil || !exists {
			println("DB ERROR:", err.Error())
			c.JSON(400, gin.H{"error": "user does not exist: " + user})
			return
		}

		_, err = tx.Exec(
			`INSERT INTO chat_members (chat_id, user_id)
			 VALUES ($1, $2)`,
			chatID, user,
		)
		if err != nil {
			println("DB ERROR:", err.Error())
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
	}

	// 4️⃣ Commit
	if err = tx.Commit(); err != nil {
		println("DB ERROR:", err.Error())
		c.JSON(500, gin.H{"error": "commit failed"})
		return
	}

	c.JSON(200, gin.H{"chat_id": chatID})
}

func GetChats(c *gin.Context) {
	userID := c.GetString("user_id")

	rows, err := db.DB.Query(`
		SELECT 
			c.id,
			c.is_group,
			c.name, -- Add group name
			ARRAY_AGG(DISTINCT m.user_id) AS members,
			COUNT(msg.id) FILTER (
				WHERE msg.sender_id <> $1 AND msg.status <> 'seen'
			) AS unread_count,
			MAX(msg.created_at) AS last_activity,
			-- Get last message content for preview
			(SELECT content FROM messages 
			 WHERE chat_id = c.id 
			 ORDER BY created_at DESC LIMIT 1) AS last_message,
			-- Get last message timestamp for sorting
			(SELECT created_at FROM messages 
			 WHERE chat_id = c.id 
			 ORDER BY created_at DESC LIMIT 1) AS last_message_time,
			-- Get last message sender for display
			(SELECT sender_id FROM messages 
			 WHERE chat_id = c.id 
			 ORDER BY created_at DESC LIMIT 1) AS last_message_sender
		FROM chats c
		JOIN chat_members m ON m.chat_id = c.id
		LEFT JOIN messages msg ON msg.chat_id = c.id
		WHERE c.id IN (
			SELECT chat_id FROM chat_members WHERE user_id = $1
		)
		GROUP BY c.id, c.is_group, c.name
		ORDER BY 
			-- Pin chats with unread messages first
			CASE WHEN COUNT(msg.id) FILTER (
				WHERE msg.sender_id <> $1 AND msg.status <> 'seen'
			) > 0 THEN 0 ELSE 1 END,
			-- Then by last activity (most recent first)
			COALESCE(MAX(msg.created_at), c.created_at) DESC
	`, userID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	type ChatResponse struct {
		ID                 string    `json:"id"`
		IsGroup            bool      `json:"is_group"`
		Name               *string   `json:"name,omitempty"` // Add group name
		Members            []string  `json:"members"`
		UnreadCount        int       `json:"unread_count"`
		LastActivity       time.Time `json:"last_activity"`
		LastMessage        *string   `json:"last_message,omitempty"`
		LastMessageTime    *string   `json:"last_message_time,omitempty"`
		LastMessageSender  *string   `json:"last_message_sender,omitempty"`
	}

	var chats []ChatResponse

	for rows.Next() {
		var chat ChatResponse
		var lastActivity sql.NullTime
		var lastMessage, lastMessageTime, lastMessageSender sql.NullString
		var groupName sql.NullString // For nullable group name
		
		if err := rows.Scan(
			&chat.ID, 
			&chat.IsGroup, 
			&groupName, // Scan group name
			pq.Array(&chat.Members), 
			&chat.UnreadCount,
			&lastActivity,
			&lastMessage,
			&lastMessageTime,
			&lastMessageSender,
		); err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}
		
		// Set group name if exists
		if groupName.Valid {
			chat.Name = &groupName.String
		}
		
		if lastActivity.Valid {
			chat.LastActivity = lastActivity.Time
		}
		
		if lastMessage.Valid {
			chat.LastMessage = &lastMessage.String
		}
		
		if lastMessageTime.Valid {
			chat.LastMessageTime = &lastMessageTime.String
		}
		
		if lastMessageSender.Valid {
			chat.LastMessageSender = &lastMessageSender.String
		}
		
		chats = append(chats, chat)
	}

	c.JSON(200, chats)
}

func AddMember(c *gin.Context) {
	chatID := c.Param("id")

	var req struct {
		UserID string `json:"user_id"`
	}
	if err := c.BindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	_, err := db.DB.Exec(
		"INSERT INTO chat_members (chat_id, user_id) VALUES ($1, $2)",
		chatID,
		req.UserID,
	)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user already in chat"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "member added"})
}
