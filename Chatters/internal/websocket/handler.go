package websocket

import (
	"net/http"

	"messenger/internal/auth" // 🔑 use auth package directly

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // dev only
	},
}

func HandleWebSocket(hub *Hub) gin.HandlerFunc {
	return func(c *gin.Context) {

		// 🔑 token from query param
		tokenStr := c.Query("token")
		if tokenStr == "" {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}

		// 🔐 validate JWT (same logic as middleware)
		token, claims, err := auth.ValidateToken(tokenStr)
		if err != nil || !token.Valid {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}

		// 🔑 extract user_id
		userID, ok := claims["user_id"].(string)
		if !ok {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}

		// 🔌 upgrade connection
		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			return
		}

		client := &Client{
			UserID: userID,
			Conn:   conn,
			Send:   make(chan []byte),
		}

		hub.Register <- client

		go writePump(client)
		go readPump(hub, client)
	}
}
