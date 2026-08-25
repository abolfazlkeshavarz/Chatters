package websocket

import (
	"encoding/json"
	"sync"
	"time"

	"messenger/internal/db"

	"github.com/gorilla/websocket"
)

const (
	// How long to wait for a pong before declaring the peer gone. Mobile
	// browsers freeze timers when backgrounded, so without this the server
	// keeps dead sockets around indefinitely.
	pongWait = 60 * time.Second
	// Must be comfortably shorter than pongWait.
	pingPeriod = 25 * time.Second
	writeWait  = 10 * time.Second

	maxIncomingMessageSize = 64 * 1024
	sendBuffer             = 64
)

type Client struct {
	UserID string
	Conn   *websocket.Conn
	Send   chan []byte

	// done is closed exactly once when this client is finished.
	//
	// Send itself is deliberately never closed. The hub fans messages out
	// from HTTP handler goroutines, so closing Send on unregister would race
	// those senders — and sending on a closed channel is a panic that takes
	// the whole process down, not merely a data race. Signalling completion
	// on a separate channel keeps every send safe.
	done      chan struct{}
	closeOnce sync.Once
}

func NewClient(userID string, conn *websocket.Conn) *Client {
	return &Client{
		UserID: userID,
		Conn:   conn,
		Send:   make(chan []byte, sendBuffer),
		done:   make(chan struct{}),
	}
}

// close marks the client finished and drops the socket. Safe to call from any
// goroutine, any number of times.
func (c *Client) close() {
	c.closeOnce.Do(func() {
		close(c.done)
		if c.Conn != nil {
			_ = c.Conn.Close()
		}
	})
}

// trySend queues a message without ever blocking the caller. It reports false
// if the client is gone or its buffer is full, in which case the connection is
// dropped and the client is expected to reconnect and resync.
func (c *Client) trySend(data []byte) bool {
	select {
	case <-c.done:
		return false
	default:
	}

	select {
	case c.Send <- data:
		return true
	case <-c.done:
		return false
	default:
		// The peer has stopped draining. Dropping the connection is better
		// than letting one stalled client back up the hub.
		c.close()
		return false
	}
}

func readPump(hub *Hub, client *Client) {
	defer func() {
		hub.Unregister(client)
		client.close()
	}()

	client.Conn.SetReadLimit(maxIncomingMessageSize)
	_ = client.Conn.SetReadDeadline(time.Now().Add(pongWait))
	client.Conn.SetPongHandler(func(string) error {
		return client.Conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	for {
		_, message, err := client.Conn.ReadMessage()
		if err != nil {
			return
		}

		var msg ChatMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "ping":
			// Application-level heartbeat from the browser, which cannot send
			// protocol-level pings from JavaScript.
			if data, err := json.Marshal(map[string]string{"type": "pong"}); err == nil {
				client.trySend(data)
			}

		case "seen":
			markSeen(hub, msg.ChatID, client.UserID)

		default:
			// Never trust a client-supplied sender.
			msg.From = client.UserID
			select {
			case hub.Incoming <- msg:
			default:
				// Hub is saturated; dropping is preferable to blocking the
				// read loop and stalling this connection's keepalive.
			}
		}
	}
}

func markSeen(hub *Hub, chatID, userID string) {
	if chatID == "" || !isChatMember(chatID, userID) {
		return
	}

	rows, err := db.DB.Query(
		`UPDATE messages
		 SET status = $3
		 WHERE chat_id = $1 AND sender_id IS DISTINCT FROM $2 AND status <> $3
		 RETURNING id`,
		chatID, userID, StatusSeen,
	)
	if err != nil {
		return
	}
	defer rows.Close()

	var seenIDs []int
	for rows.Next() {
		var id int
		if rows.Scan(&id) == nil {
			seenIDs = append(seenIDs, id)
		}
	}

	if len(seenIDs) > 0 {
		hub.BroadcastStatus(chatID, StatusSeen, seenIDs)
	}
}

func writePump(client *Client) {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		client.close()
	}()

	for {
		select {
		case msg := <-client.Send:
			_ = client.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := client.Conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}

		case <-client.done:
			_ = client.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			_ = client.Conn.WriteMessage(websocket.CloseMessage, []byte{})
			return

		case <-ticker.C:
			// Keeps NAT/proxy timeouts from silently dropping an idle socket,
			// and detects a peer that has gone away without a close frame.
			_ = client.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := client.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
