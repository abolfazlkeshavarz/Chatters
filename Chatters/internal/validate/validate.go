package validate

import (
	"errors"
	"net/mail"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Usernames double as the primary key and appear in URLs, so keep them to a
// conservative, unambiguous character set.
var usernameRe = regexp.MustCompile(`^[A-Za-z0-9._-]{3,32}$`)

const (
	MinPasswordLen = 8
	MaxPasswordLen = 128
	MaxContentLen  = 8000
)

func Username(u string) (string, error) {
	u = strings.TrimSpace(u)
	if !usernameRe.MatchString(u) {
		return "", errors.New("username must be 3-32 characters, using letters, digits, dot, underscore or hyphen")
	}
	return u, nil
}

func Email(e string) (string, error) {
	e = strings.TrimSpace(e)
	if utf8.RuneCountInString(e) > 254 {
		return "", errors.New("email address is too long")
	}
	addr, err := mail.ParseAddress(e)
	if err != nil {
		return "", errors.New("invalid email address")
	}
	return strings.ToLower(addr.Address), nil
}

func Password(p string) error {
	// Measured in bytes because bcrypt silently truncates past 72 of them.
	if len(p) < MinPasswordLen {
		return errors.New("password must be at least 8 characters")
	}
	if len(p) > MaxPasswordLen {
		return errors.New("password is too long")
	}
	return nil
}

func MessageContent(c string) error {
	if utf8.RuneCountInString(c) > MaxContentLen {
		return errors.New("message is too long")
	}
	return nil
}
