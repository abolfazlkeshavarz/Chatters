package auth

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var jwtSecret = []byte("CHANGE_THIS_SECRET")

func GenerateToken(userID string) (string, error) {
	claims := jwt.MapClaims{
		"user_id": userID,
		"exp":     time.Now().Add(72 * time.Hour).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

func ValidateToken(tokenString string) (*jwt.Token, jwt.MapClaims, error) {
	claims := jwt.MapClaims{}

	token, err := jwt.ParseWithClaims(
		tokenString,
		claims,
		func(token *jwt.Token) (interface{}, error) {
			return jwtSecret, nil
		},
	)

	return token, claims, err
}
