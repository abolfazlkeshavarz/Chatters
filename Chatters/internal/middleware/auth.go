package middleware

import (
	"database/sql"
	"net/http"
	"strings"

	"messenger/internal/auth"
	"messenger/internal/db"

	"github.com/gin-gonic/gin"
)

// LookupUser resolves the live account state for a validated token. Checking
// token_version on every request is what makes "admin resets the password" or
// "admin deletes the account" take effect immediately instead of waiting up to
// 72 hours for the JWT to expire.
func LookupUser(userID string, tokenVersion int) (isAdmin bool, ok bool) {
	var version int
	err := db.DB.QueryRow(
		`SELECT is_admin, token_version FROM users WHERE id = $1`,
		userID,
	).Scan(&isAdmin, &version)

	if err == sql.ErrNoRows || err != nil {
		return false, false
	}
	if version != tokenVersion {
		return false, false
	}
	return isAdmin, true
}

func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if header == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
			return
		}

		tokenStr := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
		token, claims, err := auth.ValidateToken(tokenStr)
		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}

		userID, ok := claims["user_id"].(string)
		if !ok || userID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token data"})
			return
		}

		isAdmin, ok := LookupUser(userID, auth.TokenVersion(claims))
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "session expired"})
			return
		}

		sid := auth.SessionID(claims)
		if sid != "" && !touchSession(sid, userID) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "session expired"})
			return
		}

		c.Set("user_id", userID)
		c.Set("is_admin", isAdmin)
		c.Set("session_id", sid)
		c.Next()
	}
}

// touchSession reports whether the session still exists (it is deleted when
// the user signs that device out) and bumps its last-seen time, at most once
// a minute so ordinary API traffic does not turn into a write per request.
func touchSession(sid, userID string) bool {
	var stale bool
	err := db.DB.QueryRow(
		`SELECT last_seen_at < now() - interval '1 minute'
		 FROM sessions WHERE id = $1 AND user_id = $2 AND expires_at > now()`,
		sid, userID,
	).Scan(&stale)
	if err != nil {
		return false
	}
	if stale {
		_, _ = db.DB.Exec(`UPDATE sessions SET last_seen_at = now() WHERE id = $1`, sid)
	}
	return true
}

// AdminMiddleware must run after AuthMiddleware.
func AdminMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if isAdmin, _ := c.Get("is_admin"); isAdmin != true {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "admin access required"})
			return
		}
		c.Next()
	}
}
