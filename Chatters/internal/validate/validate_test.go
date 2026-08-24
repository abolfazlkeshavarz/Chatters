package validate

import "testing"

func TestUsername(t *testing.T) {
	valid := []string{"abc", "ali9x3f", "a_b-c.d", "User123", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
	for _, u := range valid {
		if _, err := Username(u); err != nil {
			t.Errorf("Username(%q) rejected a valid name: %v", u, err)
		}
	}

	invalid := []struct{ name, why string }{
		{"ab", "too short"},
		{"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "33 characters, too long"},
		{"", "empty"},
		{"has space", "whitespace"},
		{"../etc", "path traversal characters"},
		{"a/b", "slash"},
		{`a\b`, "backslash"},
		{"user@host", "at sign"},
		{"drop;table", "semicolon"},
		{"emoji😀", "non-ascii"},
		{"a%20b", "percent encoding"},
	}
	for _, tc := range invalid {
		if _, err := Username(tc.name); err == nil {
			t.Errorf("Username(%q) accepted an invalid name (%s)", tc.name, tc.why)
		}
	}
}

func TestUsernameTrimsSurroundingSpace(t *testing.T) {
	got, err := Username("  alice  ")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "alice" {
		t.Errorf("got %q, want %q", got, "alice")
	}
}

func TestEmail(t *testing.T) {
	got, err := Email("  Alice@Example.COM ")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Normalised to lowercase so "A@x.com" and "a@x.com" cannot both register.
	if got != "alice@example.com" {
		t.Errorf("got %q, want %q", got, "alice@example.com")
	}

	for _, bad := range []string{"", "not-an-email", "@example.com", "a@", "a b@c.com"} {
		if _, err := Email(bad); err == nil {
			t.Errorf("Email(%q) accepted an invalid address", bad)
		}
	}
}

func TestPassword(t *testing.T) {
	if err := Password("12345678"); err != nil {
		t.Errorf("8 characters should be allowed: %v", err)
	}
	if err := Password("1234567"); err == nil {
		t.Error("7 characters should be rejected")
	}
	if err := Password(string(make([]byte, MaxPasswordLen+1))); err == nil {
		t.Error("over-long password should be rejected")
	}
}

func TestMessageContent(t *testing.T) {
	if err := MessageContent("hello"); err != nil {
		t.Errorf("unexpected error: %v", err)
	}

	// Counted in runes, not bytes: a Persian message must not be cut short.
	runes := make([]rune, MaxContentLen)
	for i := range runes {
		runes[i] = 'س'
	}
	if err := MessageContent(string(runes)); err != nil {
		t.Errorf("message at the rune limit should be allowed: %v", err)
	}
	if err := MessageContent(string(append(runes, 'س'))); err == nil {
		t.Error("message past the rune limit should be rejected")
	}
}
