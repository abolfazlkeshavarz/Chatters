package websocket

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"messenger/internal/cache"
)

// fanoutChannel carries every message the hub delivers to a specific user,
// across every backend replica. Publishing here — rather than each replica
// tracking which other replica holds which user's connection — is what lets a
// message from a user connected to replica A reach a recipient connected to
// replica B: every replica subscribes to this one channel and locally
// delivers whatever it finds addressed to a user it actually has connected.
// A replica silently drops anything addressed to a user it does not have
// connected, which includes messages this same replica published — that is
// by design, see dispatch below.
const fanoutChannel = "chatters:ws:fanout"

const presenceTTL = 24 * time.Hour

type fanoutEnvelope struct {
	UserID string          `json:"user_id"`
	Data   json.RawMessage `json:"data"`
}

// dispatch is every code path's single way to deliver to a user; nothing in
// this package should call sendTo directly except this function and the
// subscriber loop below.
//
// Without Redis it calls sendTo immediately — identical to this app's
// original single-process behaviour, so a deployment with no Redis pays
// nothing for this indirection.
//
// With Redis it publishes instead of delivering locally, even for a user
// connected to this same replica: that keeps exactly one delivery code path
// (the subscriber loop) rather than two copies of the "who do I have
// connected" logic that could drift apart. This replica receives its own
// publish back over the subscription, same as every other replica.
func (h *Hub) dispatch(userID string, data []byte) {
	if !cache.Enabled() {
		h.sendTo(userID, data)
		return
	}

	envelope, err := json.Marshal(fanoutEnvelope{UserID: userID, Data: data})
	if err != nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if err := cache.Client.Publish(ctx, fanoutChannel, envelope).Err(); err != nil {
		// Redis is down. Deliver locally rather than dropping the message
		// outright — this replica's own users still get it, which is
		// strictly better than losing it, even though a recipient on another
		// replica will not.
		log.Printf("websocket: redis publish failed, delivering locally only: %v", err)
		h.sendTo(userID, data)
	}
}

// StartPubSub subscribes this replica to the fanout channel. A no-op without
// Redis. Blocks until ctx is cancelled, so run it in a goroutine.
func (h *Hub) StartPubSub(ctx context.Context) {
	if !cache.Enabled() {
		return
	}

	sub := cache.Client.Subscribe(ctx, fanoutChannel)
	defer sub.Close()

	log.Println("websocket: subscribed to redis fanout channel")

	ch := sub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			var envelope fanoutEnvelope
			if err := json.Unmarshal([]byte(msg.Payload), &envelope); err != nil {
				continue
			}
			h.sendTo(envelope.UserID, envelope.Data)
		}
	}
}

// markOnline and markOffline record presence in Redis so IsOnline reflects
// every replica, not just this one. presenceKey uses a Set rather than a
// single flag with a TTL because a user can hold connections open on more
// than one replica (a phone and a laptop) at once; the set's membership is
// exactly "which connections currently exist", updated precisely on
// connect/disconnect rather than inferred from a heartbeat.
//
// The TTL on the set itself is a safety net, not the normal cleanup path:
// normal cleanup is markOffline, called from Unregister, which always runs
// (via a defer in readPump) for both a graceful close and an abrupt one. The
// TTL only matters if a replica is killed hard enough that its defers never
// ran, so a stale entry does not linger forever.
func (h *Hub) markOnline(userID, connID string) {
	if !cache.Enabled() {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	key := presenceKey(userID)
	pipe := cache.Client.TxPipeline()
	pipe.SAdd(ctx, key, connID)
	pipe.Expire(ctx, key, presenceTTL)
	if _, err := pipe.Exec(ctx); err != nil {
		log.Printf("websocket: redis presence add failed: %v", err)
	}
}

func (h *Hub) markOffline(userID, connID string) {
	if !cache.Enabled() {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if err := cache.Client.SRem(ctx, presenceKey(userID), connID).Err(); err != nil {
		log.Printf("websocket: redis presence remove failed: %v", err)
	}
}

// isOnlineShared reports presence across every replica. Only meaningful with
// Redis configured — callers check cache.Enabled() (via IsOnline) before
// relying on it instead of the local-only view.
func isOnlineShared(userID string) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	n, err := cache.Client.SCard(ctx, presenceKey(userID)).Result()
	return n > 0, err
}

func presenceKey(userID string) string {
	return "presence:" + userID
}
