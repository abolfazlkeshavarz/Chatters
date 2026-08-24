package websocket

import (
	"sync"
	"testing"
	"time"
)

// newTestClient builds a Client without a real network connection. close() is
// nil-safe, so the missing Conn is fine.
func newTestClient(userID string) *Client {
	return NewClient(userID, nil)
}

func newTestHub() *Hub {
	return &Hub{
		clients:  make(map[string]map[*Client]bool),
		Incoming: make(chan ChatMessage, 16),
	}
}

// The original hub stored one client per user, so opening a second connection
// silently displaced the first. A phone waking from background does exactly
// that, which is why messages stopped arriving until the app was restarted.
func TestHubKeepsEveryConnectionForAUser(t *testing.T) {
	h := newTestHub()

	phone := newTestClient("alice")
	laptop := newTestClient("alice")

	h.Register(phone)
	h.Register(laptop)

	if !h.IsOnline("alice") {
		t.Fatal("alice should be online")
	}

	h.sendTo("alice", []byte("hello"))

	for name, c := range map[string]*Client{"phone": phone, "laptop": laptop} {
		select {
		case got := <-c.Send:
			if string(got) != "hello" {
				t.Errorf("%s received %q, want %q", name, got, "hello")
			}
		default:
			t.Errorf("%s received nothing; a second connection displaced it", name)
		}
	}
}

// The precise regression: a stale socket finishing its teardown after a fresh
// one has registered must not unregister the fresh one.
func TestHubUnregisterOnlyDropsThatConnection(t *testing.T) {
	h := newTestHub()

	stale := newTestClient("alice")
	fresh := newTestClient("alice")

	h.Register(stale)
	h.Register(fresh)

	// The old connection's read loop finally notices it is dead.
	h.Unregister(stale)

	if !h.IsOnline("alice") {
		t.Fatal("alice went offline when only her stale connection closed")
	}

	h.sendTo("alice", []byte("still here"))

	select {
	case got := <-fresh.Send:
		if string(got) != "still here" {
			t.Errorf("got %q, want %q", got, "still here")
		}
	default:
		t.Fatal("the live connection stopped receiving after the stale one closed")
	}
}

func TestHubGoesOfflineOnlyWhenLastConnectionCloses(t *testing.T) {
	h := newTestHub()

	a := newTestClient("alice")
	b := newTestClient("alice")
	h.Register(a)
	h.Register(b)

	h.Unregister(a)
	if !h.IsOnline("alice") {
		t.Error("alice should still be online with one connection left")
	}

	h.Unregister(b)
	if h.IsOnline("alice") {
		t.Error("alice should be offline once every connection has closed")
	}

	h.mu.RLock()
	_, present := h.clients["alice"]
	h.mu.RUnlock()
	if present {
		t.Error("the empty connection set should have been cleaned up")
	}
}

// Unregistering twice must not panic by closing an already-closed channel.
func TestHubDoubleUnregisterIsSafe(t *testing.T) {
	h := newTestHub()
	c := newTestClient("alice")

	h.Register(c)
	h.Unregister(c)
	h.Unregister(c) // must be a no-op

	if h.IsOnline("alice") {
		t.Error("alice should be offline")
	}
}

func TestHubUnregisterUnknownClientIsSafe(t *testing.T) {
	h := newTestHub()
	h.Unregister(newTestClient("nobody")) // must not panic
}

// BroadcastSeen and BroadcastMedia are called from HTTP handler goroutines
// while Run() mutates the client map. Before the mutex this was a genuine
// concurrent map read/write, which crashes the whole process.
//
// Run with -race for this to be meaningful.
func TestHubConcurrentAccessIsRaceFree(t *testing.T) {
	h := newTestHub()

	const workers = 16
	const iterations = 200

	var wg sync.WaitGroup
	users := []string{"alice", "bob", "carol", "dave"}

	// Churn connections.
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			user := users[i%len(users)]
			for j := 0; j < iterations; j++ {
				c := newTestClient(user)
				h.Register(c)
				h.Unregister(c)
			}
		}(i)
	}

	// Fan out messages at the same time.
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			user := users[i%len(users)]
			for j := 0; j < iterations; j++ {
				h.sendTo(user, []byte("ping"))
				h.IsOnline(user)
			}
		}(i)
	}

	wg.Wait()

	for _, u := range users {
		if h.IsOnline(u) {
			t.Errorf("%s should be offline after every connection was unregistered", u)
		}
	}
}

// A peer that stops draining must not be able to block the hub. sendTo drops
// to the default branch instead of waiting on a full buffer.
func TestHubDoesNotBlockOnFullSendBuffer(t *testing.T) {
	h := newTestHub()

	c := &Client{UserID: "alice", Send: make(chan []byte, 1), done: make(chan struct{})}
	h.Register(c)

	// Fill the buffer.
	c.Send <- []byte("first")

	done := make(chan struct{})
	go func() {
		defer close(done)
		// Without the non-blocking send in sendTo this would deadlock.
		h.sendTo("alice", []byte("second"))
	}()

	select {
	case <-done:
		// Reaching here at all proves sendTo did not block on the full buffer.
	case <-time.After(2 * time.Second):
		t.Fatal("sendTo blocked on a client that stopped draining its buffer")
	}
}
