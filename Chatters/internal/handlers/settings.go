package handlers

import (
	"net/http"
	"strconv"

	"messenger/internal/db"

	"github.com/gin-gonic/gin"
)

const maxE2ERetentionSeconds = 365 * 24 * 3600 // 1 year; guards against a fat-fingered value

// AdminGetE2ERetention reports the current auto-delete window for end-to-end
// encrypted chat messages. 0 means "never".
func AdminGetE2ERetention(c *gin.Context) {
	seconds, _ := strconv.Atoi(db.GetSetting(db.SettingE2ERetentionSeconds, "0"))
	c.JSON(http.StatusOK, gin.H{"retention_seconds": seconds})
}

// AdminSetE2ERetention changes it. Takes effect on the next sweep (every few
// minutes), not retroactively on messages already past the new window until
// then.
func AdminSetE2ERetention(c *gin.Context) {
	var req struct {
		RetentionSeconds int `json:"retention_seconds"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.RetentionSeconds < 0 || req.RetentionSeconds > maxE2ERetentionSeconds {
		c.JSON(http.StatusBadRequest, gin.H{"error": "retention_seconds must be between 0 (never) and 31536000 (1 year)"})
		return
	}

	if err := db.SetSetting(db.SettingE2ERetentionSeconds, strconv.Itoa(req.RetentionSeconds)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save setting"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok", "retention_seconds": req.RetentionSeconds})
}

// AdminPurgeE2EMessages immediately deletes every message in every end-to-end
// encrypted chat, independent of the retention window. The chats and their
// encrypted status remain; only their content is cleared.
func AdminPurgeE2EMessages(c *gin.Context) {
	n, err := db.PurgeAllE2EMessages()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "purge failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok", "deleted": n})
}
