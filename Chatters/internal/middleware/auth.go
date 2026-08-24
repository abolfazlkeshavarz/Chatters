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

		c.Set("user_id", userID)
		c.Set("is_admin", isAdmin)
		c.Next()
	}
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
