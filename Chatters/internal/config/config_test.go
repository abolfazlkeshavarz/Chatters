package config

import (
	"database/sql"
	"net/url"
	"testing"

	_ "github.com/lib/pq"
)

// A generated password is full of characters that mean something inside a URL.
// "openssl rand -base64 32" emits "+", "/" and "="; people also paste in
// passphrases containing spaces, "@" and "#". Every one of these must survive
// the round trip into the DSN.
func TestDatabaseURLEscapesPasswords(t *testing.T) {
	passwords := []string{
		"a pass with spaces",
		"sl/ash+plus=equals", // typical base64 output
		"at@sign",            // would otherwise split the userinfo
		"colon:inside",       // would otherwise split user from password
		"hash#fragment",      // would otherwise start a URL fragment
		"question?mark",      // would otherwise start the query
		"per%cent",           // must not be treated as an escape
		`quote'and"double`,
		"unicode-رمز-عبور",
	}

	for _, pw := range passwords {
		t.Run(pw, func(t *testing.T) {
			t.Setenv("DB_USER", "chatters")
			t.Setenv("DB_PASSWORD", pw)
			t.Setenv("DB_HOST", "db")
			t.Setenv("DB_PORT", "5432")
			t.Setenv("DB_NAME", "messenger")
			t.Setenv("DB_SSLMODE", "disable")

			dsn := databaseURL()

			u, err := url.Parse(dsn)
			if err != nil {
				t.Fatalf("generated an unparseable DSN %q: %v", dsn, err)
			}

			if got, _ := u.User.Password(); got != pw {
				t.Errorf("password did not survive the round trip: got %q, want %q", got, pw)
			}
			if u.User.Username() != "chatters" {
				t.Errorf("username = %q, want %q", u.User.Username(), "chatters")
			}
			// The decisive check: none of the password leaked into the host or
			// database name.
			if u.Host != "db:5432" {
				t.Errorf("host = %q, want %q — the password corrupted the DSN", u.Host, "db:5432")
			}
			if u.Path != "/messenger" {
				t.Errorf("path = %q, want %q — the password corrupted the DSN", u.Path, "/messenger")
			}
			if u.Query().Get("sslmode") != "disable" {
				t.Errorf("sslmode = %q, want disable", u.Query().Get("sslmode"))
			}
		})
	}
}

// lib/pq must also accept what we produce, not just net/url.
func TestDatabaseURLIsAcceptedByTheDriver(t *testing.T) {
	t.Setenv("DB_PASSWORD", "sl/ash+plus=equals and spaces")
	t.Setenv("DB_HOST", "db")

	// Opens lazily, so this validates the DSN without needing a live database.
	db, err := sql.Open("postgres", databaseURL())
	if err != nil {
		t.Fatalf("driver rejected the generated DSN: %v", err)
	}
	defer db.Close()
}

func TestDatabaseURLPrefersExplicitDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://someone:else@elsewhere:5432/other?sslmode=require")
	t.Setenv("DB_HOST", "ignored")

	if got := databaseURL(); got != "postgres://someone:else@elsewhere:5432/other?sslmode=require" {
		t.Errorf("DATABASE_URL should win, got %q", got)
	}
}

func TestOriginAllowedSameOrigin(t *testing.T) {
	C.AllowedOrigins = nil

	// The reverse-proxy deployment serves the SPA and API from one hostname,
	// so this must work with no configuration at all.
	if !OriginAllowed("https://chat.example.com", "chat.example.com") {
		t.Error("same-origin request was rejected")
	}
	if !OriginAllowed("http://localhost:8080", "localhost:8080") {
		t.Error("same-origin localhost request was rejected")
	}
}

func TestOriginAllowedRejectsForeignOrigin(t *testing.T) {
	C.AllowedOrigins = nil

	bad := []string{
		"https://evil.example.com",
		"https://chat.example.com.evil.com", // suffix trick
		"https://notchat.example.com",
		"null",
	}
	for _, origin := range bad {
		if OriginAllowed(origin, "chat.example.com") {
			t.Errorf("OriginAllowed(%q) = true, want false", origin)
		}
	}
}

func TestOriginAllowedUsesAllowlist(t *testing.T) {
	C.AllowedOrigins = []string{"https://app.example.com", "http://localhost:3000"}

	if !OriginAllowed("https://app.example.com", "api.example.com") {
		t.Error("allow-listed origin was rejected")
	}
	if !OriginAllowed("http://localhost:3000", "api.example.com") {
		t.Error("allow-listed dev origin was rejected")
	}
	if OriginAllowed("https://other.example.com", "api.example.com") {
		t.Error("origin outside the allowlist was accepted")
	}
}

func TestOriginAllowedIgnoresTrailingSlash(t *testing.T) {
	C.AllowedOrigins = []string{"https://app.example.com/"}

	if !OriginAllowed("https://app.example.com", "api.example.com") {
		t.Error("trailing slash in configuration should not matter")
	}
}

func TestOriginAllowedEmptyOrigin(t *testing.T) {
	C.AllowedOrigins = nil

	// curl and native clients send no Origin. There is no CSRF surface without
	// a browser, and the bearer token is still required by the middleware.
	if !OriginAllowed("", "chat.example.com") {
		t.Error("absent Origin header should be allowed")
	}
}
