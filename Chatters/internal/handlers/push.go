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
