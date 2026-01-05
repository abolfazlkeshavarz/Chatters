package handlers

import (
	"messenger/internal/auth"
	"messenger/internal/db"
	"net/http"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

func Register(c *gin.Context) {
	var req struct {
		Username string `json:"username"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "invalid request"})
		return
	}

	if req.Username == "" || req.Email == "" || req.Password == "" {
		c.JSON(400, gin.H{"error": "all fields required"})
		return
	}

	// 1️⃣ check email uniqueness
	var emailExists bool
	db.DB.QueryRow(
		`SELECT EXISTS (SELECT 1 FROM users WHERE email = $1)`,
		req.Email,
	).Scan(&emailExists)

	if emailExists {
		c.JSON(400, gin.H{"error": "email already registered"})
		return
	}

	// 2️⃣ check username uniqueness (NO AUTO POSTFIX)
	var usernameExists bool
	db.DB.QueryRow(
		`SELECT EXISTS (SELECT 1 FROM users WHERE id = $1)`,
		req.Username,
	).Scan(&usernameExists)

	if usernameExists {
		c.JSON(400, gin.H{
			"error": "username already taken, please choose another (add letters or numbers)",
		})
		return
	}

	// 3️⃣ hash password
	hash, err := bcrypt.GenerateFromPassword(
		[]byte(req.Password),
		bcrypt.DefaultCost,
	)
	if err != nil {
		c.JSON(500, gin.H{"error": "password error"})
		return
	}

	// 4️⃣ insert user
	_, err = db.DB.Exec(
		`INSERT INTO users (id, email, password_hash)
		 VALUES ($1, $2, $3)`,
		req.Username, req.Email, string(hash),
	)

	if err != nil {
		c.JSON(500, gin.H{"error": "failed to create user"})
		return
	}

	c.JSON(200, gin.H{
		"status":   "ok",
		"username": req.Username,
	})
}

func Login(c *gin.Context) {
	var req struct {
		Identifier string `json:"username"` // username OR email
		Password   string `json:"password"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "invalid request"})
		return
	}

	var userID string
	var hash string

	err := db.DB.QueryRow(
		`SELECT id, password_hash
		 FROM users
		 WHERE id = $1 OR email = $1`,
		req.Identifier,
	).Scan(&userID, &hash)

	if err != nil || bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)) != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}

	token, _ := auth.GenerateToken(userID)
	c.JSON(http.StatusOK, gin.H{"token": token})
}
