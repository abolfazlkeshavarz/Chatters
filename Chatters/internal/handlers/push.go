package handlers

import (
	"net/http"

	"messenger/internal/config"
	"messenger/internal/db"
	"messenger/internal/push"

	"github.com/gin-gonic/gin"
)

// PushPublicKey hands the browser the VAPID application server key it needs to
// call PushManager.subscribe(). This is public by design.
func PushPublicKey(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"public_key": config.C.VAPIDPublicKey,
		"enabled":    push.Enabled(),
	})
}

func Subscribe(c *gin.Context) {
	userID := c.GetString("user_id")

	var req struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}

	if err := c.ShouldBindJSON(&req); err != nil ||
		req.Endpoint == "" || req.Keys.P256dh == "" || req.Keys.Auth == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid subscription"})
		return
	}

	// An endpoint is unique per browser install. Re-subscribing after a
	// re-login should move it to the current user, not fail.
	_, err := db.DB.Exec(
		`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (endpoint) DO UPDATE
		   SET user_id = EXCLUDED.user_id,
		       p256dh  = EXCLUDED.p256dh,
		       auth    = EXCLUDED.auth`,
		userID, req.Endpoint, req.Keys.P256dh, req.Keys.Auth,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save subscription"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "subscribed"})
}

// RegisterDevice stores (or moves to the current user) the Expo push token a
// native app install obtained from expo-notifications. Called on every app
// launch once notifications are granted, so it is an idempotent upsert.
func RegisterDevice(c *gin.Context) {
	userID := c.GetString("user_id")

	var req struct {
		Token    string `json:"token"`
		Platform string `json:"platform"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid token"})
		return
	}

	platform := req.Platform
	if platform == "" {
		platform = "expo"
	}

	_, err := db.DB.Exec(
		`INSERT INTO device_push_tokens (token, user_id, platform)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (token) DO UPDATE
		   SET user_id    = EXCLUDED.user_id,
		       platform   = EXCLUDED.platform,
		       updated_at = now()`,
		req.Token, userID, platform,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save device"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "registered"})
}

// UnregisterDevice drops a native app install's push token, e.g. on sign-out
// or when the user turns notifications off in the app.
func UnregisterDevice(c *gin.Context) {
	userID := c.GetString("user_id")

	var req struct {
		Token string `json:"token"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	_, err := db.DB.Exec(
		`DELETE FROM device_push_tokens WHERE token = $1 AND user_id = $2`,
		req.Token, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to remove device"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "unregistered"})
}

func Unsubscribe(c *gin.Context) {
	userID := c.GetString("user_id")

	var req struct {
		Endpoint string `json:"endpoint"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Endpoint == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	_, err := db.DB.Exec(
		`DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2`,
		req.Endpoint, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to remove subscription"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "unsubscribed"})
}
