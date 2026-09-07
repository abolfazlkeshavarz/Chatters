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

// Everything a human might type as a separator. Stripped before validating so
// "+98 912 345 6789", "0912-345-6789" and "+989123456789" are the same number.
var phoneSeparators = strings.NewReplacer(" ", "", "-", "", "(", "", ")", "", ".", "")

// Phone normalises a telephone number to digits with an optional leading "+".
//
// Numbers are an identifier people are looked up by, so two spellings of the
// same number must not become two different accounts — normalising here is
// what makes the UNIQUE index on users(phone) mean what it says.
func Phone(p string) (string, error) {
	p = phoneSeparators.Replace(strings.TrimSpace(p))
	if p == "" {
		return "", errors.New("phone number is required")
	}

	plus := strings.HasPrefix(p, "+")
	digits := strings.TrimPrefix(p, "+")

	for _, r := range digits {
		if r < '0' || r > '9' {
			return "", errors.New("phone number may only contain digits, spaces, and + - ( ) .")
		}
	}
	// E.164 allows at most 15 digits; below 7 is not a dialable number
	// anywhere, so anything shorter is a typo rather than a short code.
	if len(digits) < 7 || len(digits) > 15 {
		return "", errors.New("phone number must be between 7 and 15 digits")
	}

	if plus {
		return "+" + digits, nil
	}
	return digits, nil
}
