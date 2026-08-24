package handlers

import (
	"database/sql"
	"net/http"

	"messenger/internal/auth"
	"messenger/internal/db"
	"messenger/internal/validate"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

// Comparing against this pre-computed hash when the account does not exist
// keeps the failure path the same cost as the success path, so response timing
// no longer reveals which usernames are registered.
var dummyHash = []byte("$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy")

// KeyBundle is the client-generated end-to-end encryption material. The
// private key arrives already encrypted under a key derived from the user's
// password, so the server only ever stores an opaque blob.
type KeyBundle struct {
	PublicKey           string `json:"public_key"`
	EncryptedPrivateKey string `json:"encrypted_private_key"`
	KeySalt             string `json:"key_salt"`
	KeyNonce            string `json:"key_nonce"`
}

func (k KeyBundle) complete() bool {
	return k.PublicKey != "" && k.EncryptedPrivateKey != "" && k.KeySalt != "" && k.KeyNonce != ""
}

func Register(c *gin.Context) {
	var req struct {
		Username string `json:"username"`
		Email    string `json:"email"`
		Password string `json:"password"`
		Keys     *KeyBundle `json:"keys"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	username, err := validate.Username(req.Username)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	email, err := validate.Email(req.Email)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validate.Password(req.Password); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "password error"})
		return
	}

	var keys KeyBundle
	if req.Keys != nil && req.Keys.complete() {
		keys = *req.Keys
	}

	// Let the unique constraints decide instead of pre-checking: a check
	// followed by an insert races two concurrent signups for the same name.
	_, err = db.DB.Exec(
		`INSERT INTO users (id, email, password_hash, public_key, encrypted_private_key, key_salt, key_nonce)
		 VALUES ($1, $2, $3, NULLIF($4,''), NULLIF($5,''), NULLIF($6,''), NULLIF($7,''))`,
		username, email, string(hash),
		keys.PublicKey, keys.EncryptedPrivateKey, keys.KeySalt, keys.KeyNonce,
	)

	if err != nil {
		if isUniqueViolation(err, "users_pkey") {
			c.JSON(http.StatusConflict, gin.H{
				"error": "username already taken, please choose another (add letters or numbers)",
			})
			return
		}
		if isUniqueViolation(err, "users_email_key") {
			c.JSON(http.StatusConflict, gin.H{"error": "email already registered"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create user"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok", "username": username})
}

func Login(c *gin.Context) {
	var req struct {
		Identifier string `json:"username"` // username OR email
		Password   string `json:"password"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	var (
		userID  string
		hash    string
		version int
		isAdmin bool
		keys    KeyBundle
		pubKey  sql.NullString
		encPriv sql.NullString
		salt    sql.NullString
		nonce   sql.NullString
	)

	err := db.DB.QueryRow(
		`SELECT id, password_hash, token_version, is_admin,
		        public_key, encrypted_private_key, key_salt, key_nonce
		 FROM users
		 WHERE id = $1 OR email = lower($1)`,
		req.Identifier,
	).Scan(&userID, &hash, &version, &isAdmin, &pubKey, &encPriv, &salt, &nonce)

	if err != nil {
		// Still spend the bcrypt time so a missing account is indistinguishable
		// from a wrong password.
		_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(req.Password))
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}

	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)) != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}

	token, err := auth.GenerateToken(userID, version)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to issue token"})
		return
	}

	keys = KeyBundle{
		PublicKey:           pubKey.String,
		EncryptedPrivateKey: encPriv.String,
		KeySalt:             salt.String,
		KeyNonce:            nonce.String,
	}

	c.JSON(http.StatusOK, gin.H{
		"token":    token,
		"username": userID,
		"is_admin": isAdmin,
		"keys":     keys,
		// Tells the client it must generate a key pair and POST /api/keys.
		"needs_key_setup": !keys.complete(),
	})
}
