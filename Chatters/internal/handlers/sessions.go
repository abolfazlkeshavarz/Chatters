package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"messenger/internal/auth"
	"messenger/internal/db"

	"github.com/gin-gonic/gin"
)

// createSession records a sign-in and returns its id, which goes into the
// token as "sid". Expired rows for the same user are pruned on the way.
func createSession(userID, device, platform string, c *gin.Context) (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	id := hex.EncodeToString(buf)

	device = clip(strings.TrimSpace(device), 100)
	platform = clip(strings.TrimSpace(platform), 30)
	if device == "" {
		device, platform = describeUserAgent(c.GetHeader("User-Agent"))
	}

	_, _ = db.DB.Exec(`DELETE FROM sessions WHERE user_id = $1 AND expires_at < now()`, userID)
	_, err := db.DB.Exec(
		`INSERT INTO sessions (id, user_id, device, platform, ip, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		id, userID, device, platform, clip(c.ClientIP(), 64), time.Now().Add(auth.TokenTTL),
	)
	return id, err
}

func clip(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// describeUserAgent turns a browser User-Agent into "Chrome on Windows".
func describeUserAgent(ua string) (device, platform string) {
	has := func(s string) bool { return strings.Contains(ua, s) }

	switch {
	case has("iPhone"), has("iPad"):
		platform = "ios"
	case has("Android"):
		platform = "android"
	case has("Windows"):
		platform = "windows"
	case has("Mac OS"):
		platform = "macos"
	case has("Linux"):
		platform = "linux"
	default:
		platform = "web"
	}

	browser := "Browser"
	switch {
	case has("Edg/"):
		browser = "Edge"
	case has("Firefox/"):
		browser = "Firefox"
	case has("Chrome/"):
		browser = "Chrome"
	case has("Safari/"):
		browser = "Safari"
	}

	names := map[string]string{
		"ios": "iOS", "android": "Android", "windows": "Windows",
		"macos": "macOS", "linux": "Linux", "web": "the web",
	}
	return browser + " on " + names[platform], "web"
}

// ListSessions returns the caller's active sign-ins, newest activity first.
func ListSessions(c *gin.Context) {
	userID := c.GetString("user_id")
	current := c.GetString("session_id")

	rows, err := db.DB.Query(
		`SELECT id, device, platform, ip, created_at, last_seen_at
		 FROM sessions
		 WHERE user_id = $1 AND expires_at > now()
		 ORDER BY last_seen_at DESC`,
		userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load sessions"})
		return
	}
	defer rows.Close()

	type session struct {
		ID         string    `json:"id"`
		Device     string    `json:"device"`
		Platform   string    `json:"platform"`
		IP         string    `json:"ip"`
		CreatedAt  time.Time `json:"created_at"`
		LastSeenAt time.Time `json:"last_seen_at"`
		Current    bool      `json:"current"`
	}

	out := []session{}
	for rows.Next() {
		var s session
		if err := rows.Scan(&s.ID, &s.Device, &s.Platform, &s.IP, &s.CreatedAt, &s.LastSeenAt); err != nil {
			continue
		}
		s.Current = s.ID == current
		out = append(out, s)
	}

	c.JSON(http.StatusOK, gin.H{"sessions": out, "current": current})
}

// RevokeSession signs one of the caller's devices out. The id "current"
// means the calling session itself, which is how the apps sign out.
func RevokeSession(c *gin.Context) {
	id := c.Param("id")
	if id == "current" {
		id = c.GetString("session_id")
	}
	res, err := db.DB.Exec(
		`DELETE FROM sessions WHERE id = $1 AND user_id = $2`,
		id, c.GetString("user_id"),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to sign out the session"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// RevokeOtherSessions signs out every device except the one calling.
//
// Tokens issued before sessions existed carry no "sid" and cannot be listed
// or revoked one by one; bumping token_version would sign out this device
// too, so they are left to expire on their own (at most 72 hours).
func RevokeOtherSessions(c *gin.Context) {
	res, err := db.DB.Exec(
		`DELETE FROM sessions WHERE user_id = $1 AND id <> $2`,
		c.GetString("user_id"), c.GetString("session_id"),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to sign out other sessions"})
		return
	}
	n, _ := res.RowsAffected()
	c.JSON(http.StatusOK, gin.H{"status": "ok", "revoked": n})
}
