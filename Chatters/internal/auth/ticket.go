package auth

import (
	"crypto/rand"
	"encoding/base64"
	"sync"
	"time"
)

// Browsers cannot attach an Authorization header to a WebSocket handshake, so
// the token has to travel in the URL. Putting the long-lived JWT there leaks
// it into proxy logs, browser history and Referer headers. Instead we mint a
// single-use ticket that is valid for a few seconds and dies on first use.

const ticketTTL = 30 * time.Second

type ticket struct {
	userID  string
	version int
	expires time.Time
}

var (
	ticketsMu sync.Mutex
	tickets   = map[string]ticket{}
)

func IssueTicket(userID string, version int) (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	id := base64.RawURLEncoding.EncodeToString(buf)

	ticketsMu.Lock()
	defer ticketsMu.Unlock()

	pruneLocked()
	tickets[id] = ticket{userID: userID, version: version, expires: time.Now().Add(ticketTTL)}

	return id, nil
}

// RedeemTicket consumes a ticket, returning the user it was issued to.
func RedeemTicket(id string) (userID string, version int, ok bool) {
	ticketsMu.Lock()
	defer ticketsMu.Unlock()

	t, found := tickets[id]
	if !found {
		return "", 0, false
	}
	delete(tickets, id)

	if time.Now().After(t.expires) {
		return "", 0, false
	}
	return t.userID, t.version, true
}

func pruneLocked() {
	now := time.Now()
	for id, t := range tickets {
		if now.After(t.expires) {
			delete(tickets, id)
		}
	}
}
