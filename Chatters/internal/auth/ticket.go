package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	"messenger/internal/cache"
)

// Browsers cannot attach an Authorization header to a WebSocket handshake, so
// the token has to travel in the URL. Putting the long-lived JWT there leaks
// it into proxy logs, browser history and Referer headers. Instead we mint a
// single-use ticket that is valid for a few seconds and dies on first use.
//
// With Redis configured, tickets live there with a TTL and are redeemed with
// GETDEL, so a ticket issued by one backend replica can be redeemed by
// whichever replica the WebSocket upgrade happens to land on. Without Redis,
// tickets are kept in an in-memory map — correct for a single process, and
// nothing extra to run for local development.

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

	if cache.Enabled() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		value := fmt.Sprintf("%s:%d", userID, version)
		if err := cache.Client.Set(ctx, ticketKey(id), value, ticketTTL).Err(); err != nil {
			log.Printf("ticket: redis error issuing ticket, falling back to in-memory: %v", err)
		} else {
			return id, nil
		}
	}

	ticketsMu.Lock()
	defer ticketsMu.Unlock()

	pruneLocked()
	tickets[id] = ticket{userID: userID, version: version, expires: time.Now().Add(ticketTTL)}

	return id, nil
}

// RedeemTicket consumes a ticket, returning the user it was issued to. Tries
// Redis first (where a valid ticket may live if another replica issued it)
// and falls back to the in-memory map, so a ticket issued during a Redis
// hiccup on this same replica still works.
func RedeemTicket(id string) (userID string, version int, ok bool) {
	if cache.Enabled() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		// GETDEL is atomic: two concurrent redemptions of the same ticket
		// cannot both succeed.
		value, err := cache.Client.GetDel(ctx, ticketKey(id)).Result()
		if err == nil {
			if u, v, ok := parseTicketValue(value); ok {
				return u, v, true
			}
		}
	}

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

func ticketKey(id string) string {
	return "ws_ticket:" + id
}

func parseTicketValue(value string) (userID string, version int, ok bool) {
	userID, versionStr, found := strings.Cut(value, ":")
	if !found {
		return "", 0, false
	}
	v, err := strconv.Atoi(versionStr)
	if err != nil {
		return "", 0, false
	}
	return userID, v, true
}

func pruneLocked() {
	now := time.Now()
	for id, t := range tickets {
		if now.After(t.expires) {
			delete(tickets, id)
		}
	}
}
