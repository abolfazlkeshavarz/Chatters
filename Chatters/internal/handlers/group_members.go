package handlers

import (
	"net/http"
	"messenger/internal/db"
	"github.com/gin-gonic/gin"
)

func GetChatMembers(c *gin.Context) {
	chatID := c.Param("id")
	userID := c.GetString("user_id")

	// Check if user is a member of the chat
	var isMember bool
	err := db.DB.QueryRow(
		`SELECT EXISTS (
			SELECT 1 FROM chat_members 
			WHERE chat_id = $1 AND user_id = $2
		)`,
		chatID, userID,
	).Scan(&isMember)

	if err != nil || !isMember {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a chat member"})
		return
	}

	// Get chat details including if it's a group
	var isGroup bool
	var groupName *string
	err = db.DB.QueryRow(
		`SELECT is_group, name FROM chats WHERE id = $1`,
		chatID,
	).Scan(&isGroup, &groupName)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "chat not found"})
		return
	}

	// Get all members
	rows, err := db.DB.Query(
		`SELECT user_id FROM chat_members WHERE chat_id = $1`,
		chatID,
	)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var members []string
	for rows.Next() {
		var member string
		rows.Scan(&member)
		members = append(members, member)
	}

	c.JSON(http.StatusOK, gin.H{
		"is_group":   isGroup,
		"group_name": groupName,
		"members":    members,
	})
}