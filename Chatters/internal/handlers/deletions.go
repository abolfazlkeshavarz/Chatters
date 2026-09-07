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
		  WHERE m.id = $1 AND m.deleted_at IS NULL`,
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
		// Stamped, not deleted: every user-facing query filters deleted_at, so
		// this is indistinguishable from a hard delete for the people in the
		// chat, while the moderation panel can still produce it. The attachment
		// is deliberately left on disk for the same reason — removing the file
		// would leave an admin a row naming evidence that no longer exists.
		if _, err := db.DB.Exec(
			`UPDATE messages SET deleted_at = now(), deleted_by = $2
			 WHERE id = $1 AND deleted_at IS NULL`,
			msgID, me,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete message"})
			return
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
		 WHERE c.id = $1 AND c.deleted_at IS NULL AND EXISTS (
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

		tx, err := db.DB.Begin()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
			return
		}
		defer tx.Rollback()

		// Snapshot the roster before it is torn down, so the panel can still
		// say who was in a conversation nobody is a member of any more.
		for _, m := range members {
			_, _ = tx.Exec(
				`INSERT INTO chat_member_history (chat_id, user_id) VALUES ($1, $2)
				 ON CONFLICT DO NOTHING`,
				chatID, m,
			)
		}
		if _, err := tx.Exec(
			`UPDATE chats SET deleted_at = now(), deleted_by = $2
			 WHERE id = $1 AND deleted_at IS NULL`,
			chatID, me,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete chat"})
			return
		}
		// Frees the pair for a fresh conversation later; the row itself, its
		// messages and its uploads all stay for the panel.
		_, _ = tx.Exec(`DELETE FROM direct_chat_pairs WHERE chat_id = $1`, chatID)
		_, _ = tx.Exec(`DELETE FROM chat_members WHERE chat_id = $1`, chatID)

		if err := tx.Commit(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "commit failed"})
			return
		}

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

	// Recorded before the membership row goes, so a conversation everyone has
	// left still knows who was in it.
	_, _ = tx.Exec(
		`INSERT INTO chat_member_history (chat_id, user_id) VALUES ($1, $2)
		 ON CONFLICT DO NOTHING`,
		chatID, me,
	)
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
		// Soft, for the same reason as above: the last person leaving is not a
		// reason to destroy the transcript the panel may need.
		_, _ = tx.Exec(
			`UPDATE chats SET deleted_at = now(), deleted_by = $2
			 WHERE id = $1 AND deleted_at IS NULL`,
			chatID, me,
		)
	}
	// Leaving frees the pair either way: the remaining member should be able to
	// start a fresh conversation rather than being stuck with one nobody else
	// is in.
	_, _ = tx.Exec(`DELETE FROM direct_chat_pairs WHERE chat_id = $1`, chatID)

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "commit failed"})
		return
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
