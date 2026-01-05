package handlers

import (
	"net/http"
	"github.com/lib/pq"
	"messenger/internal/db"

	"github.com/gin-gonic/gin"
)

func CreateChat(c *gin.Context) {
	creator := c.GetString("user_id")

	var req struct {
		Members []string `json:"members"`
		IsGroup bool     `json:"is_group"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		println("DB ERROR:", err.Error())
		c.JSON(400, gin.H{"error": "invalid request"})
		return
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

	// 1️⃣ Create chat
	var chatID string
	err = tx.QueryRow(
		`INSERT INTO chats (is_group)
		 VALUES ($1)
		 RETURNING id`,
		req.IsGroup,
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
			ARRAY_AGG(m.user_id) AS members
		FROM chats c
		JOIN chat_members m ON m.chat_id = c.id
		WHERE c.id IN (
			SELECT chat_id FROM chat_members WHERE user_id = $1
		)
		GROUP BY c.id, c.is_group
	`, userID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	type ChatResponse struct {
		ID      string   `json:"id"`
		IsGroup bool     `json:"is_group"`
		Members []string `json:"members"`
	}

	var chats []ChatResponse

	for rows.Next() {
		var chat ChatResponse
		if err := rows.Scan(&chat.ID, &chat.IsGroup, pq.Array(&chat.Members)); err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
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
