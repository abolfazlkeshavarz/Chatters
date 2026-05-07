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

    mimeType := file.Header.Get("Content-Type")
    
    // Start transaction
    tx, err := db.DB.Begin()
    if err != nil {
        c.JSON(500, gin.H{"error": "db error"})
        return
    }
    defer tx.Rollback()

    // 1️⃣ Insert into messages table (for chat history)
    var messageID int
    var createdAt string
    err = tx.QueryRow(
        `INSERT INTO messages (chat_id, sender_id, content, type, file_path, filename, mime_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, created_at`,
        chatID,
        userID,
        filename, // content will be filename for media
        "media",  // type = 'media' instead of 'text'
        path,
        file.Filename,
        mimeType,
    ).Scan(&messageID, &createdAt)

    if err != nil {
        c.JSON(500, gin.H{"error": "failed to save message: " + err.Error()})
        return
    }

    // 2️⃣ Also insert into media_messages table for download tracking
    _, err = tx.Exec(
        `INSERT INTO media_messages (id, chat_id, sender_id, file_path, mime_type)
         VALUES ($1, $2, $3, $4, $5)`,
        messageID,  // Use same ID as messages table
        chatID,
        userID,
        path,
        mimeType,
    )

    if err != nil {
        c.JSON(500, gin.H{"error": "db error: " + err.Error()})
        return
    }

    if err = tx.Commit(); err != nil {
        c.JSON(500, gin.H{"error": "commit failed: " + err.Error()})
        return
    }

    // 🔔 Broadcast media message
    websocket.GlobalHub.BroadcastMedia(
        chatID,
        messageID,
        file.Filename,
        userID,
        createdAt,
    )

    c.JSON(200, gin.H{"message_id": messageID})
}
