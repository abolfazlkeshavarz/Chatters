package config

import "testing"

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
