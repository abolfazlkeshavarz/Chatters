package push

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
	"sync"

	"messenger/internal/config"
	"messenger/internal/db"

	webpush "github.com/SherClockHolmes/webpush-go"
)

// endpointHost returns just the scheme+host of a push endpoint for logging.
// The full endpoint embeds a per-subscription token that should not land in
// logs; the host alone ("https://web.push.apple.com") is enough to tell which
// push service rejected a send.
func endpointHost(endpoint string) string {
	u, err := url.Parse(endpoint)
	if err != nil || u.Host == "" {
		return "unknown"
	}
	return u.Scheme + "://" + u.Host
}

// Notification is the payload the service worker receives. For end-to-end
// encrypted chats the body is intentionally a fixed placeholder: the server
// holds no key that could decrypt the real content, so there is nothing
// meaningful it could put here even if it wanted to.
type Notification struct {
	Type   string `json:"type"`
	Title  string `json:"title"`
	Body   string `json:"body"`
	ChatID string `json:"chat_id"`
	From   string `json:"from"`
}

var (
	enabledOnce sync.Once
	enabled     bool
)

// Enabled reports whether VAPID credentials are configured. Without them push
// is simply skipped — the app still works, it just cannot wake a closed tab.
func Enabled() bool {
	enabledOnce.Do(func() {
		enabled = config.C.VAPIDPublicKey != "" && config.C.VAPIDPrivateKey != ""
		if !enabled {
			log.Println("push: VAPID keys not configured, web push notifications are disabled")
		}
	})
	return enabled
}

// SendToUser delivers a notification to every browser the user has subscribed
// from. Subscriptions the push service reports as gone are pruned.
func SendToUser(userID string, n Notification) {
	if !Enabled() {
		return
	}

	payload, err := json.Marshal(n)
	if err != nil {
		return
	}

	rows, err := db.DB.Query(
		`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
		userID,
	)
	if err != nil {
		return
	}

	type sub struct{ endpoint, p256dh, auth string }
	var subs []sub

	for rows.Next() {
		var s sub
		if err := rows.Scan(&s.endpoint, &s.p256dh, &s.auth); err == nil {
			subs = append(subs, s)
		}
	}
	rows.Close()

	for _, s := range subs {
		go func(s sub) {
			resp, err := webpush.SendNotification(payload, &webpush.Subscription{
				Endpoint: s.endpoint,
				Keys:     webpush.Keys{P256dh: s.p256dh, Auth: s.auth},
			}, &webpush.Options{
				Subscriber:      config.C.VAPIDSubject,
				VAPIDPublicKey:  config.C.VAPIDPublicKey,
				VAPIDPrivateKey: config.C.VAPIDPrivateKey,
				TTL:             60 * 60 * 24,
				Urgency:         webpush.UrgencyHigh,
			})
			if err != nil {
				log.Printf("push: send to %s failed: %v", endpointHost(s.endpoint), err)
				return
			}
			defer resp.Body.Close()

			// The endpoint is permanently dead: the user cleared site data or
			// uninstalled the PWA.
			if resp.StatusCode == http.StatusGone || resp.StatusCode == http.StatusNotFound {
				_, _ = db.DB.Exec(`DELETE FROM push_subscriptions WHERE endpoint = $1`, s.endpoint)
				return
			}

			// Any other non-2xx is a delivery failure the caller never sees
			// otherwise. Apple's gateway in particular rejects the whole
			// request (400/403) for a malformed VAPID subject or a public key
			// that does not match the signing key — log the body so the reason
			// is visible.
			if resp.StatusCode < 200 || resp.StatusCode >= 300 {
				body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
				log.Printf("push: %s returned %d: %s", endpointHost(s.endpoint), resp.StatusCode, body)
			}
		}(s)
	}
}
