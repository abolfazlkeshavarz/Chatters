package handlers

import (
	"database/sql"
	"net/http"
	"strings"

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

// Register files a signup request rather than creating the account.
//
// Nothing is usable until an administrator approves it from the panel, so this
// endpoint never issues a token and the caller cannot log in afterwards. The
// key bundle the browser generated is carried through verbatim and installed
// on the account at approval time, which is what lets the user's original
// password still unwrap their private key once they are let in.
func Register(c *gin.Context) {
	var req struct {
		Username string     `json:"username"`
		Email    string     `json:"email"`
		Phone    string     `json:"phone"`
		Password string     `json:"password"`
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

	// Optional at signup: an account with no number is approved without one and
	// can request it later from the profile page.
	var phone sql.NullString
	if strings.TrimSpace(req.Phone) != "" {
		normalised, err := validate.Phone(req.Phone)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		phone = sql.NullString{String: normalised, Valid: true}
	}

	if err := validate.Password(req.Password); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Checked up front rather than left to a constraint: these clash with the
	// users table, not with another pending request, so there is no unique
	// index that would catch them and the applicant deserves to know now
	// instead of after waiting for a review that can only be rejected.
	var taken bool
	if err := db.DB.QueryRow(
		`SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 OR email = $2)`, username, email,
	).Scan(&taken); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to check availability"})
		return
	}
	if taken {
		c.JSON(http.StatusConflict, gin.H{"error": "that username or email is already registered"})
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

	_, err = db.DB.Exec(
		`INSERT INTO registration_requests
		   (username, email, phone, password_hash,
		    public_key, encrypted_private_key, key_salt, key_nonce)
		 VALUES ($1, $2, $3, $4, NULLIF($5,''), NULLIF($6,''), NULLIF($7,''), NULLIF($8,''))`,
		username, email, phone, string(hash),
		keys.PublicKey, keys.EncryptedPrivateKey, keys.KeySalt, keys.KeyNonce,
	)
	if err != nil {
		if isUniqueViolation(err, "idx_regreq_pending_username") ||
			isUniqueViolation(err, "idx_regreq_pending_email") {
			c.JSON(http.StatusConflict, gin.H{
				"error": "a request with that username or email is already waiting for review",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to submit request"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":   "pending",
		"username": username,
		"message":  "your request was submitted and is waiting for an administrator to approve it",
	})
}

func Login(c *gin.Context) {
	var req struct {
		Identifier string `json:"username"` // username OR email
		Password   string `json:"password"`
		// Optional, shown in the "active sessions" list. Browsers do not
		// send them and get a label parsed from their User-Agent instead.
		Device   string `json:"device"`
		Platform string `json:"platform"`
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

	sid, err := createSession(userID, req.Device, req.Platform, c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to start session"})
		return
	}

	token, err := auth.GenerateToken(userID, version, sid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to issue token"})
		return
	}

	// Best-effort: the panel's "last seen" column is informational, and a
	// failed write here must not cost the user their sign-in.
	_, _ = db.DB.Exec(`UPDATE users SET last_seen_at = now() WHERE id = $1`, userID)

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
