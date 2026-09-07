package handlers

import (
	"database/sql"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"messenger/internal/config"
	"messenger/internal/db"
	"messenger/internal/websocket"

	"github.com/gin-gonic/gin"
)

type deleteScopeReq struct {
	Scope string `json:"scope"` // "me" (default) or "everyone"
}

// DeleteMessage removes a message either just for the caller ("me": a per-user
// tombstone, the row survives for other members) or for everyone ("everyone":
// the row is hard-deleted). "Everyone" is allowed when the caller sent the
// message, or in any secret chat where both members share that power.
func DeleteMessage(c *gin.Context) {
	me := c.GetString("user_id")

	msgID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid message id"})
		return
	}

	var req deleteScopeReq
	_ = c.ShouldBindJSON(&req)
	if req.Scope == "" {
		req.Scope = "me"
	}

	var chatID, msgType string
	var sender sql.NullString
	var filePath sql.NullString
	var isSecret bool
	err = db.DB.QueryRow(
		`SELECT m.chat_id, m.type, m.sender_id, m.file_path, c.is_secret
		   FROM messages m JOIN chats c ON c.id = m.chat_id
		  WHERE m.id = $1`,
		msgID,
	).Scan(&chatID, &msgType, &sender, &filePath, &isSecret)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "message not found"})
		return
	}
	if !isChatMember(chatID, me) {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a chat member"})
		return
	}

	if req.Scope == "everyone" {
		if sender.String != me && !isSecret {
			c.JSON(http.StatusForbidden, gin.H{
				"error": "you can only delete your own messages for everyone",
			})
			return
		}
		if _, err := db.DB.Exec(`DELETE FROM messages WHERE id = $1`, msgID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete message"})
			return
		}
		if filePath.Valid && filePath.String != "" && withinUploadDir(filePath.String) {
			_ = os.Remove(filePath.String)
		}
		if websocket.GlobalHub != nil {
			websocket.GlobalHub.BroadcastEvent(chatID, map[string]interface{}{
				"type":    "deleted",
				"chat_id": chatID,
				"ids":     []int{msgID},
			})
		}
		c.JSON(http.StatusOK, gin.H{"status": "deleted", "scope": "everyone"})
		return
	}

	// scope == "me"
	if _, err := db.DB.Exec(
		`INSERT INTO message_deletions (message_id, user_id) VALUES ($1, $2)
		 ON CONFLICT DO NOTHING`,
		msgID, me,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete message"})
		return
	}
	if websocket.GlobalHub != nil {
		websocket.GlobalHub.NotifyUser(me, map[string]interface{}{
			"type":    "deleted",
			"chat_id": chatID,
			"ids":     []int{msgID},
			"scope":   "me",
		})
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted", "scope": "me"})
}

// DeleteChat removes a conversation for the caller ("me": leave it / drop it
// from your list; the chat is deleted outright once nobody is left) or, for a
// one-to-one or secret chat, for everyone.
func DeleteChat(c *gin.Context) {
	me := c.GetString("user_id")
	chatID := c.Param("id")

	var req deleteScopeReq
	_ = c.ShouldBindJSON(&req)
	if req.Scope == "" {
		req.Scope = "me"
	}

	var isGroup, isSecret bool
	if err := db.DB.QueryRow(
		`SELECT c.is_group, c.is_secret FROM chats c
		 WHERE c.id = $1 AND EXISTS (
		   SELECT 1 FROM chat_members cm WHERE cm.chat_id = c.id AND cm.user_id = $2
		 )`,
		chatID, me,
	).Scan(&isGroup, &isSecret); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "not a chat member"})
		return
	}

	if req.Scope == "everyone" {
		if isGroup {
			c.JSON(http.StatusForbidden, gin.H{
				"error": "you can only leave a group, not delete it for everyone",
			})
			return
		}
		members := chatMembersList(chatID)
		if websocket.GlobalHub != nil {
			websocket.GlobalHub.BroadcastEventToMembers(members, map[string]interface{}{
				"type":    "chat_deleted",
				"chat_id": chatID,
			})
		}
		if _, err := db.DB.Exec(`DELETE FROM chats WHERE id = $1`, chatID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete chat"})
			return
		}
		removeChatUploads(chatID)
		c.JSON(http.StatusOK, gin.H{"status": "deleted", "scope": "everyone"})
		return
	}

	// scope == "me": leave the chat and forget my per-chat state.
	tx, err := db.DB.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	defer tx.Rollback()

	_, _ = tx.Exec(`DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2`, chatID, me)
	_, _ = tx.Exec(`DELETE FROM chat_mutes WHERE chat_id = $1 AND user_id = $2`, chatID, me)
	_, _ = tx.Exec(
		`DELETE FROM message_deletions md USING messages m
		 WHERE md.message_id = m.id AND m.chat_id = $1 AND md.user_id = $2`,
		chatID, me,
	)

	var remaining int
	_ = tx.QueryRow(`SELECT COUNT(*) FROM chat_members WHERE chat_id = $1`, chatID).Scan(&remaining)
	emptied := remaining == 0
	if emptied {
		_, _ = tx.Exec(`DELETE FROM chats WHERE id = $1`, chatID)
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "commit failed"})
		return
	}
	if emptied {
		removeChatUploads(chatID)
	}

	if websocket.GlobalHub != nil {
		websocket.GlobalHub.NotifyUser(me, map[string]interface{}{
			"type":    "chat_deleted",
			"chat_id": chatID,
			"scope":   "me",
		})
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted", "scope": "me"})
}

// removeChatUploads best-effort deletes a chat's attachment directory. The DB
// rows are already gone via cascade; this reclaims the files they pointed at.
func removeChatUploads(chatID string) {
	dir := filepath.Join(config.C.UploadDir, chatID)
	if withinUploadDir(dir) {
		_ = os.RemoveAll(dir)
	}
}
