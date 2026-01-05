package middleware

import (
	"net/http"
	"strings"

	"messenger/internal/auth"

	"github.com/gin-gonic/gin"
)

func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if header == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
			return
		}

		tokenStr := strings.TrimPrefix(header, "Bearer ")
		token, claims, err := auth.ValidateToken(tokenStr)

		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}

		userID, ok := claims["user_id"].(string)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token data"})
			return
		}

		c.Set("user_id", userID)

		c.Set("user_id", claims["user_id"])

		c.Next()
	}
}
