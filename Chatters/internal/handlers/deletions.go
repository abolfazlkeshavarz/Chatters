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
// the row and its attachment, if any, are gone for good). "Everyone" is
// allowed when the caller sent the message, or in any secret chat where both
// members share that power.
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
		// A real delete: nothing is kept for later review. The row is gone,
		// and so is its attachment, if it had one.
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

// chatFilePaths returns the disk paths of every attachment in a chat, for
// removal after the chat row itself (and the messages naming them) is gone.
func chatFilePaths(q interface {
	Query(string, ...interface{}) (*sql.Rows, error)
}, chatID string) []string {
	var paths []string
	rows, err := q.Query(`SELECT file_path FROM messages WHERE chat_id = $1 AND file_path IS NOT NULL`, chatID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	for rows.Next() {
		var p sql.NullString
		if rows.Scan(&p) == nil && p.Valid {
			paths = append(paths, p.String)
		}
	}
	return paths
}

// DeleteChat removes a conversation for the caller ("me": leave it, or, once
// nobody is left, remove it outright) or, for a one-to-one or secret chat,
// for everyone right away. Either way nothing is kept once it is gone: the
// chat, its messages and their attachments are all deleted for good.
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

		filePaths := chatFilePaths(db.DB, chatID)
		// The chat row cascades to its members, messages, keys, mutes and the
		// direct-chat-pair slot; nothing is left behind for anyone to read.
		if _, err := db.DB.Exec(`DELETE FROM chats WHERE id = $1`, chatID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete chat"})
			return
		}
		for _, p := range filePaths {
			if withinUploadDir(p) {
				_ = os.Remove(p)
			}
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

	var filePaths []string
	if emptied {
		// Nobody is left to keep it for: remove the conversation outright
		// rather than leaving it behind once its last member has gone.
		filePaths = chatFilePaths(tx, chatID)
		if _, err := tx.Exec(`DELETE FROM chats WHERE id = $1`, chatID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete chat"})
			return
		}
	} else {
		// Frees the pair either way: the remaining member should be able to
		// start a fresh conversation rather than being stuck with one nobody
		// else is in.
		_, _ = tx.Exec(`DELETE FROM direct_chat_pairs WHERE chat_id = $1`, chatID)
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "commit failed"})
		return
	}

	for _, p := range filePaths {
		if withinUploadDir(p) {
			_ = os.Remove(p)
		}
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
