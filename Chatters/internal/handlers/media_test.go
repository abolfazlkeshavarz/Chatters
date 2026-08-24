package handlers

import (
	"path/filepath"
	"strings"
	"testing"

	"messenger/internal/config"
)

// The upload name is fully attacker-controlled, so this is the boundary that
// keeps a POST from writing outside the upload directory.
func TestSanitizeFilenameBlocksTraversal(t *testing.T) {
	cases := []struct {
		name  string
		input string
	}{
		{"parent traversal", "../../etc/passwd"},
		{"embedded traversal", "x_../../etc/passwd"},
		{"trailing traversal", "photo.png/../../../root/.ssh/authorized_keys"},
		{"windows separators", `..\..\windows\system32\config\sam`},
		{"absolute unix path", "/etc/shadow"},
		{"absolute windows path", `C:\Windows\System32\drivers\etc\hosts`},
		{"just dots", ".."},
		{"single dot", "."},
		{"hidden file", ".bashrc"},
		{"null byte", "evil\x00.png"},
		{"newline injection", "evil\n.png"},
		{"carriage return", "a\r\nContent-Type: text/html"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := sanitizeFilename(tc.input)

			if strings.Contains(got, "/") || strings.Contains(got, `\`) {
				t.Errorf("sanitizeFilename(%q) = %q, still contains a path separator", tc.input, got)
			}
			if got == ".." || got == "." || strings.HasPrefix(got, ".") {
				t.Errorf("sanitizeFilename(%q) = %q, still resolves relative to the parent", tc.input, got)
			}
			if strings.ContainsAny(got, "\x00\r\n") {
				t.Errorf("sanitizeFilename(%q) = %q, still contains control characters", tc.input, got)
			}
			if got == "" {
				t.Errorf("sanitizeFilename(%q) returned an empty name", tc.input)
			}

			// The decisive property: joining the result must stay inside the root.
			joined := filepath.Clean(filepath.Join("uploads", "chat-id", got))
			if !strings.HasPrefix(joined, filepath.Clean("uploads/chat-id")) {
				t.Errorf("joined path %q escaped the upload directory", joined)
			}
		})
	}
}

func TestSanitizeFilenameKeepsReasonableNames(t *testing.T) {
	cases := map[string]string{
		"photo.png":        "photo.png",
		"my-file_v2.tar.gz": "my-file_v2.tar.gz",
		"Report 2024.pdf":  "Report_2024.pdf", // space is replaced, not dropped
	}

	for input, want := range cases {
		if got := sanitizeFilename(input); got != want {
			t.Errorf("sanitizeFilename(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestSanitizeFilenameTruncatesLongNames(t *testing.T) {
	long := strings.Repeat("a", 500) + ".png"
	got := sanitizeFilename(long)

	if len(got) > 120 {
		t.Errorf("name not truncated: got %d characters", len(got))
	}
	// Truncating from the front preserves the extension.
	if !strings.HasSuffix(got, ".png") {
		t.Errorf("extension lost during truncation: %q", got)
	}
}

func TestWithinUploadDir(t *testing.T) {
	config.C.UploadDir = "private_uploads"

	inside := []string{
		filepath.Join("private_uploads", "abc", "1_file.png"),
		filepath.Join("private_uploads", "file.png"),
	}
	for _, p := range inside {
		if !withinUploadDir(p) {
			t.Errorf("withinUploadDir(%q) = false, want true", p)
		}
	}

	outside := []string{
		filepath.Join("private_uploads", "..", "secrets.txt"),
		filepath.Join("..", "etc", "passwd"),
		"/etc/passwd",
		"private_uploads_other/file.png", // prefix match must not be enough
	}
	for _, p := range outside {
		if withinUploadDir(p) {
			t.Errorf("withinUploadDir(%q) = true, want false", p)
		}
	}
}
