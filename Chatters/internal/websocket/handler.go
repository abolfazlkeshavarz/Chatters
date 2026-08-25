package websocket

import (
	"net/http"

	"messenger/internal/auth"
	"messenger/internal/config"
	"messenger/internal/db"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// The old handler accepted every origin, which let any website open an
	// authenticated socket on a logged-in visitor's behalf.
	CheckOrigin: func(r *http.Request) bool {
		return config.OriginAllowed(r.Header.Get("Origin"), r.Host)
	},
}

// HandleWebSocket authenticates with a single-use ticket obtained from
// POST /api/ws-ticket. Tickets expire in seconds, so unlike the long-lived JWT
// the old code accepted here, a leaked URL is not a lasting credential.
func HandleWebSocket(hub *Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		ticket := c.Query("ticket")
		if ticket == "" {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}

		userID, version, ok := auth.RedeemTicket(ticket)
		if !ok {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}

		// The account may have been deleted or had its sessions revoked
		// between issuing the ticket and redeeming it.
		var current int
		if err := db.DB.QueryRow(
			`SELECT token_version FROM users WHERE id = $1`, userID,
		).Scan(&current); err != nil || current != version {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}

		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			return
		}

		client := NewClient(userID, conn)
		hub.Register(client)

		go writePump(client)
		go readPump(hub, client)

		// Coming online is the moment queued messages actually reach this
		// device, so promote them from sent to delivered and let the senders
		// know. Done after the pumps are running so the sweep's own broadcast
		// can reach this connection too.
		go hub.MarkDelivered(userID)
	}
}
