package auth

import (
	"errors"
	"time"

	"messenger/internal/config"

	"github.com/golang-jwt/jwt/v5"
)

const TokenTTL = 72 * time.Hour

var ErrInvalidToken = errors.New("invalid token")

// GenerateToken issues an API token. version is the user's token_version at
// issue time; the auth middleware rejects the token once that value moves,
// which is how password changes and admin actions kill existing sessions.
func GenerateToken(userID string, version int) (string, error) {
	claims := jwt.MapClaims{
		"user_id": userID,
		"ver":     version,
		"iat":     time.Now().Unix(),
		"exp":     time.Now().Add(TokenTTL).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(config.C.JWTSecret)
}

func ValidateToken(tokenString string) (*jwt.Token, jwt.MapClaims, error) {
	claims := jwt.MapClaims{}

	token, err := jwt.ParseWithClaims(
		tokenString,
		claims,
		func(t *jwt.Token) (interface{}, error) {
			// Pin the algorithm: without this check an attacker could present
			// a token signed with "none" or an asymmetric-key confusion trick.
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, ErrInvalidToken
			}
			return config.C.JWTSecret, nil
		},
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
	)

	return token, claims, err
}

// TokenVersion pulls the "ver" claim out, tolerating the float64 that JSON
// numbers decode to.
func TokenVersion(claims jwt.MapClaims) int {
	switch v := claims["ver"].(type) {
	case float64:
		return int(v)
	case int:
		return v
	}
	return 0
}
