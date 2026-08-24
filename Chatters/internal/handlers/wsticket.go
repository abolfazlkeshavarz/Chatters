package handlers

import (
	"net/http"

	"messenger/internal/auth"
	"messenger/internal/db"

	"github.com/gin-gonic/gin"
)

// IssueWSTicket hands the caller a short-lived, single-use credential for the
// WebSocket handshake. Browsers cannot set an Authorization header on a
// WebSocket, and putting the real token in the query string leaks it into
// access logs and browser history.
func IssueWSTicket(c *gin.Context) {
	userID := c.GetString("user_id")

	var version int
	if err := db.DB.QueryRow(
		`SELECT token_version FROM users WHERE id = $1`, userID,
	).Scan(&version); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "session expired"})
		return
	}

	ticket, err := auth.IssueTicket(userID, version)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to issue ticket"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"ticket": ticket})
}
