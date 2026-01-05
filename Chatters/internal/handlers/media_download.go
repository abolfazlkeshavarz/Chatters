package handlers

import (
	"net/http"

	"messenger/internal/db"

	"github.com/gin-gonic/gin"
)

func DownloadMedia(c *gin.Context) {
	userID := c.GetString("user_id")
	mediaID := c.Param("id")

	var path, chatID string
	var downloaded bool

	err := db.DB.QueryRow(
		`SELECT file_path, chat_id, downloaded
		 FROM media_messages
		 WHERE id = $1`,
		mediaID,
	).Scan(&path, &chatID, &downloaded)

	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	// 🔒 Check membership
	var ok bool
	db.DB.QueryRow(
		`SELECT EXISTS (
			SELECT 1 FROM chat_members
			WHERE chat_id = $1 AND user_id = $2
		)`,
		chatID, userID,
	).Scan(&ok)

	if !ok {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	// 📤 Send file
	c.File(path)

	// Update status but DO NOT delete the file
	go func() {
		_, _ = db.DB.Exec(
			`UPDATE media_messages SET downloaded = true WHERE id = $1`,
			mediaID,
		)
	}()
}
