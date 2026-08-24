package auth

import (
	"testing"
	"time"

	"messenger/internal/config"

	"github.com/golang-jwt/jwt/v5"
)

func init() {
	config.C.JWTSecret = []byte("test-secret-that-is-long-enough-for-hs256")
}

func TestTokenRoundTrip(t *testing.T) {
	token, err := GenerateToken("alice", 3)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	parsed, claims, err := ValidateToken(token)
	if err != nil || !parsed.Valid {
		t.Fatalf("ValidateToken failed: %v", err)
	}
	if claims["user_id"] != "alice" {
		t.Errorf("user_id = %v, want alice", claims["user_id"])
	}
	if got := TokenVersion(claims); got != 3 {
		t.Errorf("TokenVersion = %d, want 3", got)
	}
}

func TestTokenRejectsWrongSecret(t *testing.T) {
	token, err := GenerateToken("alice", 0)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	original := config.C.JWTSecret
	config.C.JWTSecret = []byte("a-completely-different-signing-secret")
	defer func() { config.C.JWTSecret = original }()

	if _, _, err := ValidateToken(token); err == nil {
		t.Error("a token signed with another secret was accepted")
	}
}

// The "alg: none" family of attacks: a token that claims to need no signature
// must never validate.
func TestTokenRejectsUnsignedAlgorithm(t *testing.T) {
	unsigned := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.MapClaims{
		"user_id": "attacker",
		"ver":     0,
		"exp":     time.Now().Add(time.Hour).Unix(),
	})
	raw, err := unsigned.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("could not build the test token: %v", err)
	}

	if parsed, _, err := ValidateToken(raw); err == nil && parsed.Valid {
		t.Error("an unsigned token was accepted")
	}
}

func TestTokenRejectsExpired(t *testing.T) {
	expired := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": "alice",
		"ver":     0,
		"exp":     time.Now().Add(-time.Hour).Unix(),
	})
	raw, err := expired.SignedString(config.C.JWTSecret)
	if err != nil {
		t.Fatalf("could not build the test token: %v", err)
	}

	if _, _, err := ValidateToken(raw); err == nil {
		t.Error("an expired token was accepted")
	}
}

func TestTokenRejectsGarbage(t *testing.T) {
	for _, raw := range []string{"", "not.a.token", "a.b.c"} {
		if parsed, _, err := ValidateToken(raw); err == nil && parsed.Valid {
			t.Errorf("garbage token %q was accepted", raw)
		}
	}
}

func TestTicketIsSingleUse(t *testing.T) {
	id, err := IssueTicket("alice", 7)
	if err != nil {
		t.Fatalf("IssueTicket: %v", err)
	}

	user, version, ok := RedeemTicket(id)
	if !ok || user != "alice" || version != 7 {
		t.Fatalf("first redemption failed: user=%q version=%d ok=%v", user, version, ok)
	}

	// A replayed handshake must not work.
	if _, _, ok := RedeemTicket(id); ok {
		t.Error("ticket was redeemable twice")
	}
}

func TestTicketRejectsUnknown(t *testing.T) {
	if _, _, ok := RedeemTicket("never-issued"); ok {
		t.Error("an unknown ticket was accepted")
	}
}

func TestTicketExpires(t *testing.T) {
	id, err := IssueTicket("alice", 0)
	if err != nil {
		t.Fatalf("IssueTicket: %v", err)
	}

	// Reach into the store to age the ticket rather than sleeping for its TTL.
	ticketsMu.Lock()
	entry := tickets[id]
	entry.expires = time.Now().Add(-time.Second)
	tickets[id] = entry
	ticketsMu.Unlock()

	if _, _, ok := RedeemTicket(id); ok {
		t.Error("an expired ticket was accepted")
	}
}

func TestTicketsAreUnpredictable(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		id, err := IssueTicket("alice", 0)
		if err != nil {
			t.Fatalf("IssueTicket: %v", err)
		}
		if seen[id] {
			t.Fatal("ticket id collision")
		}
		if len(id) < 32 {
			t.Fatalf("ticket id is too short to be unguessable: %q", id)
		}
		seen[id] = true
	}
}
