package push

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"time"

	"messenger/internal/config"
	"messenger/internal/db"
)

// Expo Push is the transport for the React Native apps (Android/iOS). Unlike
// Web Push it needs no server-held key pair: a message is POSTed to Expo's
// gateway addressed by the per-install ExponentPushToken the app registered.
// So this transport is always available once a device has registered a token,
// independent of whether VAPID is configured for the web PWA.

const expoSendURL = "https://exp.host/--/api/v2/push/send"

var expoClient = &http.Client{Timeout: 10 * time.Second}

// ExpoConfigured reports whether the native-app push transport should be
// attempted. It has no hard dependency to satisfy, so it is on unless an
// operator explicitly turns it off; an optional access token is only used to
// raise Expo's rate limits and to enable push-security enforcement.
func ExpoConfigured() bool {
	return config.C.ExpoPushEnabled
}

// Active reports whether any push transport can deliver — Web Push (VAPID) or
// the native Expo transport. Callers use it to decide whether waking an
// offline recipient is even possible before doing the work to find them.
func Active() bool {
	return Enabled() || ExpoConfigured()
}

// Notify delivers a notification to every device a user has, across every
// configured transport. Best-effort: it never blocks the caller and swallows
// per-device failures after logging them.
func Notify(userID string, n Notification) {
	SendToUser(userID, n)     // Web Push (no-op unless VAPID is configured)
	SendExpoToUser(userID, n) // Native apps (no-op unless a device is registered)
}

type expoMessage struct {
	To        string            `json:"to"`
	Title     string            `json:"title"`
	Body      string            `json:"body"`
	Sound     string            `json:"sound"`
	ChannelID string            `json:"channelId,omitempty"`
	Priority  string            `json:"priority,omitempty"`
	Data      map[string]string `json:"data,omitempty"`
}

type expoResponse struct {
	Data []struct {
		Status  string `json:"status"`
		ID      string `json:"id"`
		Message string `json:"message"`
		Details struct {
			Error string `json:"error"`
		} `json:"details"`
	} `json:"data"`
}

// SendExpoToUser pushes a notification to every native-app install registered
// to the user. Tokens Expo reports as permanently invalid are pruned.
func SendExpoToUser(userID string, n Notification) {
	if !ExpoConfigured() {
		return
	}

	rows, err := db.DB.Query(
		`SELECT token FROM device_push_tokens WHERE user_id = $1`, userID,
	)
	if err != nil {
		return
	}
	var tokens []string
	for rows.Next() {
		var t string
		if rows.Scan(&t) == nil {
			tokens = append(tokens, t)
		}
	}
	rows.Close()
	if len(tokens) == 0 {
		return
	}

	messages := make([]expoMessage, 0, len(tokens))
	for _, t := range tokens {
		messages = append(messages, expoMessage{
			To:        t,
			Title:     n.Title,
			Body:      n.Body,
			Sound:     "default",
			ChannelID: "messages",
			Priority:  "high",
			Data: map[string]string{
				"type":    n.Type,
				"chat_id": n.ChatID,
				"from":    n.From,
			},
		})
	}

	go deliverExpo(tokens, messages)
}

func deliverExpo(tokens []string, messages []expoMessage) {
	payload, err := json.Marshal(messages)
	if err != nil {
		return
	}

	req, err := http.NewRequest(http.MethodPost, expoSendURL, bytes.NewReader(payload))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if config.C.ExpoAccessToken != "" {
		req.Header.Set("Authorization", "Bearer "+config.C.ExpoAccessToken)
	}

	resp, err := expoClient.Do(req)
	if err != nil {
		log.Printf("push: expo send failed: %v", err)
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		log.Printf("push: expo gateway returned %d: %s", resp.StatusCode, body)
		return
	}

	var parsed expoResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return
	}

	// Responses are positional, one per message sent.
	for i, ticket := range parsed.Data {
		if ticket.Status != "error" || i >= len(tokens) {
			continue
		}
		log.Printf("push: expo rejected a token: %s (%s)", ticket.Message, ticket.Details.Error)
		if ticket.Details.Error == "DeviceNotRegistered" {
			_, _ = db.DB.Exec(`DELETE FROM device_push_tokens WHERE token = $1`, tokens[i])
		}
	}
}
