package handlers

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"messenger/internal/db"
	"messenger/internal/websocket"

	"github.com/gin-gonic/gin"
)

func UploadMedia(c *gin.Context) {
	userID := c.GetString("user_id")
	chatID := c.PostForm("chat_id")

	// 🔒 Check chat membership
	var ok bool
	err := db.DB.QueryRow(
		`SELECT EXISTS (
			SELECT 1 FROM chat_members
			WHERE chat_id = $1 AND user_id = $2
		)`,
		chatID, userID,
	).Scan(&ok)

	if err != nil || !ok {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a chat member"})
		return
	}

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(400, gin.H{"error": "file required"})
		return
	}

	dir := filepath.Join("private_uploads", chatID)
	_ = os.MkdirAll(dir, 0700)

	filename := fmt.Sprintf("%d_%s", time.Now().UnixNano(), file.Filename)
	path := filepath.Join(dir, filename)

	if err := c.SaveUploadedFile(file, path); err != nil {
		c.JSON(500, gin.H{"error": "failed to save file"})
		return
	}

	var mediaID int
	var createdAt string

	err = db.DB.QueryRow(
		`INSERT INTO media_messages (chat_id, sender_id, file_path, mime_type)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, created_at`,
		chatID,
		userID,
		path,
		file.Header.Get("Content-Type"),
	).Scan(&mediaID, &createdAt)

	if err != nil {
		c.JSON(500, gin.H{"error": "db error"})
		return
	}

	// 🔔 Broadcast media message WITH FULL DATA
	websocket.GlobalHub.BroadcastMedia(
		chatID,
		mediaID,
		file.Filename,
		userID,
		createdAt,
	)

	c.JSON(200, gin.H{"media_id": mediaID})
}
