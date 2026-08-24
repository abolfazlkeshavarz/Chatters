package handlers

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"messenger/internal/config"
	"messenger/internal/db"
	"messenger/internal/push"
	"messenger/internal/websocket"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Anything outside this set is replaced, so a crafted upload name cannot
// introduce path separators, traversal sequences, or control characters.
var unsafeFilenameChars = regexp.MustCompile(`[^A-Za-z0-9._-]`)

// sanitizeFilename reduces an attacker-controlled upload name to a single safe
// path component. filepath.Base alone is not enough on its own: a name like
// "x_../../etc/passwd" survives Base() intact on some inputs and is then
// re-joined, so we also strip every separator character outright.
func sanitizeFilename(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, `\`, "/"))
	name = unsafeFilenameChars.ReplaceAllString(name, "_")
	name = strings.TrimLeft(name, ".")

	if name == "" {
		name = "file"
	}
	if len(name) > 120 {
		name = name[len(name)-120:]
	}
	return name
}

func UploadMedia(c *gin.Context) {
	userID := c.GetString("user_id")
	chatID := c.PostForm("chat_id")

	// Validate before it reaches the filesystem: chat ids become directory
	// names, so a non-UUID value must never get that far.
	if _, err := uuid.Parse(chatID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid chat id"})
		return
	}

	if !isChatMember(chatID, userID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a chat member"})
		return
	}

	// Reject oversized bodies before buffering them to disk.
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, config.C.MaxUploadBytes)

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file required"})
		return
	}
	if file.Size > config.C.MaxUploadBytes {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "file is too large"})
		return
	}

	originalName := sanitizeFilename(file.Filename)

	dir := filepath.Join(config.C.UploadDir, chatID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to prepare upload directory"})
		return
	}

	storedName := fmt.Sprintf("%d_%s", time.Now().UnixNano(), originalName)
	path := filepath.Join(dir, storedName)

	// Belt and braces: confirm the final path really is inside the upload root.
	if !withinUploadDir(path) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid file path"})
		return
	}

	if err := c.SaveUploadedFile(file, path); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save file"})
		return
	}

	mimeType := file.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	tx, err := db.DB.Begin()
	if err != nil {
		_ = os.Remove(path)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
			_ = os.Remove(path)
		}
	}()

	var messageID int
	var createdAt time.Time
	err = tx.QueryRow(
		`INSERT INTO messages (chat_id, sender_id, content, type, file_path, filename, mime_type)
		 VALUES ($1, $2, $3, 'media', $4, $5, $6)
		 RETURNING id, created_at`,
		chatID, userID, originalName, path, originalName, mimeType,
	).Scan(&messageID, &createdAt)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save message"})
		return
	}

	_, err = tx.Exec(
		`INSERT INTO media_messages (id, chat_id, sender_id, file_path, mime_type)
		 VALUES ($1, $2, $3, $4, $5)`,
		messageID, chatID, userID, path, mimeType,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}

	if err = tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "commit failed"})
		return
	}
	committed = true

	websocket.GlobalHub.BroadcastMedia(
		chatID, messageID, originalName, mimeType, userID, createdAt.Format(time.RFC3339Nano),
	)

	notifyChat(chatID, userID, push.Notification{
		Type:   "media",
		Title:  userID,
		Body:   "📎 " + originalName,
		ChatID: chatID,
		From:   userID,
	})

	c.JSON(http.StatusOK, gin.H{"message_id": messageID})
}

// withinUploadDir guards against a stored path escaping the upload root,
// whether through a crafted name or a legacy database row.
func withinUploadDir(path string) bool {
	root, err := filepath.Abs(config.C.UploadDir)
	if err != nil {
		return false
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(root, abs)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))
}
