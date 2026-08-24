package handlers

import (
	"net/http"
	"os"
	"strconv"

	"messenger/internal/db"

	"github.com/gin-gonic/gin"
)

func DownloadMedia(c *gin.Context) {
	userID := c.GetString("user_id")

	mediaID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid media id"})
		return
	}

	var path, chatID, filename, mimeType string

	// Authorisation is enforced in the query itself: the row only comes back
	// if the caller is a member of the chat it belongs to, so there is no
	// window where we hold a path we are not allowed to serve.
	err = db.DB.QueryRow(
		`SELECT m.file_path, m.chat_id::text, COALESCE(m.filename, 'file'), COALESCE(m.mime_type, 'application/octet-stream')
		 FROM messages m
		 WHERE m.id = $1
		   AND m.type = 'media'
		   AND m.file_path IS NOT NULL
		   AND EXISTS (
		     SELECT 1 FROM chat_members cm
		     WHERE cm.chat_id = m.chat_id AND cm.user_id = $2
		   )`,
		mediaID, userID,
	).Scan(&path, &chatID, &filename, &mimeType)

	if err != nil {
		// Deliberately identical for "does not exist" and "not yours" so the
		// endpoint cannot be used to probe which message ids are real.
		c.JSON(http.StatusNotFound, gin.H{"error": "media not found"})
		return
	}

	// Defence in depth against a legacy or tampered row pointing outside the
	// upload root.
	if !withinUploadDir(path) {
		c.JSON(http.StatusNotFound, gin.H{"error": "media not found"})
		return
	}
	if _, err := os.Stat(path); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "media not found"})
		return
	}

	go func() {
		_, _ = db.DB.Exec(`UPDATE media_messages SET downloaded = true WHERE id = $1`, mediaID)
	}()

	c.Header("Content-Type", mimeType)
	c.Header("X-Content-Type-Options", "nosniff")
	// FileAttachment quotes and escapes the filename for us, which prevents a
	// crafted name from injecting extra response headers.
	c.FileAttachment(path, filename)
}
