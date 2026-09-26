package websocket

import (
	"database/sql"
	"encoding/json"
	"strings"

	"messenger/internal/db"
)

// Voice calls are peer-to-peer WebRTC; the server only relays the signaling
// messages that let two phones find each other. Nothing here touches audio.
//
//	call_offer    caller -> callee   {call_id, sdp, device_id}
//	call_ringing  callee -> caller   the callee's phone is ringing
//	call_answer   callee -> caller   {call_id, sdp, device_id}
//	call_ice      both ways          {call_id, candidate, device_id}
//	call_reject   callee declined
//	call_busy     callee is already in a call
//	call_end      either side hung up (or cancelled before answer)
//
// Every event goes to both members, on every device they have connected.
// That lets a user's other phones stop ringing once one of them answers or
// declines; clients recognise their own echoes by device_id.
var callEvents = map[string]bool{
	"call_offer":   true,
	"call_ringing": true,
	"call_answer":  true,
	"call_ice":     true,
	"call_reject":  true,
	"call_busy":    true,
	"call_end":     true,
}

// IsCallEvent reports whether a socket message type is call signaling.
func IsCallEvent(t string) bool { return callEvents[t] }

func handleCallEvent(hub *Hub, client *Client, raw []byte) {
	var payload map[string]interface{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return
	}

	chatID, _ := payload["chat_id"].(string)
	callID, _ := payload["call_id"].(string)
	msgType, _ := payload["type"].(string)
	if chatID == "" || callID == "" || len(callID) > 64 {
		return
	}

	peer, ok := callPeer(chatID, client.UserID)
	if !ok {
		return
	}

	// Never trust a client-supplied sender.
	payload["from"] = client.UserID

	// A callee with no live connection cannot ring; say so straight away
	// rather than leaving the caller listening to a dial tone.
	if msgType == "call_offer" && !hub.IsOnline(peer) {
		if data, err := json.Marshal(map[string]interface{}{
			"type":    "call_unavailable",
			"chat_id": chatID,
			"call_id": callID,
		}); err == nil {
			hub.dispatch(client.UserID, data)
		}
		return
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	hub.dispatch(peer, data)
	hub.dispatch(client.UserID, data)
}

// callPeer returns the other member of a 1:1 chat userID belongs to. Groups
// are refused: group calls need a media server, not peer-to-peer.
func callPeer(chatID, userID string) (string, bool) {
	var isGroup bool
	err := db.DB.QueryRow(
		`SELECT is_group FROM chats WHERE id = $1 AND deleted_at IS NULL`, chatID,
	).Scan(&isGroup)
	if err != nil || isGroup || !isChatMember(chatID, userID) {
		return "", false
	}

	var peer string
	err = db.DB.QueryRow(
		`SELECT user_id FROM chat_members WHERE chat_id = $1 AND user_id <> $2 LIMIT 1`,
		chatID, userID,
	).Scan(&peer)
	if err == sql.ErrNoRows || err != nil || strings.TrimSpace(peer) == "" {
		return "", false
	}
	return peer, true
}
