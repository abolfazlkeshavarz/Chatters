package handlers

import (
    "messenger/internal/db"
    "messenger/internal/websocket"
    "net/http"
    "time"

    "github.com/gin-gonic/gin"
)

func GetMessages(c *gin.Context) {
    chatID := c.Param("chatId")
    userID := c.GetString("user_id")

    var exists bool
    db.DB.QueryRow(
        `SELECT EXISTS (
            SELECT 1 FROM chat_members
            WHERE chat_id = $1 AND user_id = $2
        )`,
        chatID, userID,
    ).Scan(&exists)

    if !exists {
        c.JSON(http.StatusForbidden, gin.H{"error": "not a chat member"})
        return
    }

    // Mark messages as seen when user fetches them
    rows, _ := db.DB.Query(
        `UPDATE messages
         SET status = 'seen'
         WHERE chat_id = $1
         AND sender_id != $2
         AND status != 'seen'
         RETURNING id`,
        chatID, userID,
    )

    var seenIDs []int
    for rows.Next() {
        var id int
        rows.Scan(&id)
        seenIDs = append(seenIDs, id)
    }

    if len(seenIDs) > 0 {
        websocket.GlobalHub.BroadcastSeen(chatID, seenIDs)
    }

    // Fetch ALL messages including media
    rows2, err := db.DB.Query(
        `SELECT 
            id, 
            sender_id, 
            content, 
            created_at, 
            status, 
            reply_to,
            type,
            file_path,
            filename,
            mime_type
         FROM messages
         WHERE chat_id = $1
         ORDER BY created_at ASC`,
        chatID,
    )

    if err != nil {
        c.JSON(500, gin.H{"error": err.Error()})
        return
    }
    defer rows2.Close()

    type Message struct {
        ID        int        `json:"id"`
        From      string     `json:"from"`
        Content   string     `json:"content"`
        CreatedAt time.Time  `json:"created_at"`
        Status    string     `json:"status"`
        ReplyTo   *int       `json:"reply_to"`
        Type      string     `json:"type"`
        FilePath  *string    `json:"file_path,omitempty"`
        Filename  *string    `json:"filename,omitempty"`
        MimeType  *string    `json:"mime_type,omitempty"`
    }

    var messages []Message
    for rows2.Next() {
        var m Message
        var replyTo *int
        var filePath, filename, mimeType *string
        
        err := rows2.Scan(
            &m.ID, 
            &m.From, 
            &m.Content, 
            &m.CreatedAt, 
            &m.Status, 
            &replyTo,
            &m.Type,
            &filePath,
            &filename,
            &mimeType,
        )
        if err != nil {
            c.JSON(500, gin.H{"error": err.Error()})
            return
        }
        
        m.ReplyTo = replyTo
        m.FilePath = filePath
        m.Filename = filename
        m.MimeType = mimeType
        messages = append(messages, m)
    }

    c.JSON(http.StatusOK, messages)
}