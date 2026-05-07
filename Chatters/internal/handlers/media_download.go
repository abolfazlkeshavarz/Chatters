package handlers

import (
    "net/http"

    "messenger/internal/db"

    "github.com/gin-gonic/gin"
)

func DownloadMedia(c *gin.Context) {
    userID := c.GetString("user_id")
    mediaID := c.Param("id")

    var path, chatID, filename, mimeType string
    var downloaded bool

    // Try to get from media_messages first (for backward compatibility)
    err := db.DB.QueryRow(
        `SELECT m.file_path, m.chat_id, m.downloaded, msg.filename, msg.mime_type
         FROM media_messages m
         JOIN messages msg ON msg.id = m.id
         WHERE m.id = $1`,
        mediaID,
    ).Scan(&path, &chatID, &downloaded, &filename, &mimeType)

    if err != nil {
        // If not found in media_messages, try messages table directly
        err = db.DB.QueryRow(
            `SELECT file_path, chat_id, filename, mime_type
             FROM messages
             WHERE id = $1 AND type = 'media'`,
            mediaID,
        ).Scan(&path, &chatID, &filename, &mimeType)
        
        if err != nil {
            c.JSON(http.StatusNotFound, gin.H{"error": "media not found"})
            return
        }
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

    // Set proper headers
    c.Header("Content-Disposition", "attachment; filename="+filename)
    c.Header("Content-Type", mimeType)
    
    // 📤 Send file
    c.File(path)

    // Update download status if exists in media_messages table
    go func() {
        _, _ = db.DB.Exec(
            `UPDATE media_messages SET downloaded = true WHERE id = $1`,
            mediaID,
        )
    }()
}