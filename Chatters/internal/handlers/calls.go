package handlers

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"net/http"
	"time"

	"messenger/internal/config"

	"github.com/gin-gonic/gin"
)

const turnCredentialTTL = 12 * time.Hour

// defaultSTUN is used when STUN_URLS is not set. A public STUN server only
// tells a phone its own public address; it never carries audio.
var defaultSTUN = []string{"stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"}

// IceServers hands the app the WebRTC ICE servers for a call.
//
// TURN credentials follow coturn's "TURN REST API" scheme (use-auth-secret):
// username is "<expiry unix time>:<user id>", password is
// base64(HMAC-SHA1(TURN_SECRET, username)). coturn checks both itself, so the
// secret never leaves the server and a leaked credential dies with its expiry.
func IceServers(c *gin.Context) {
	stun := config.C.STUNURLs
	if len(stun) == 0 {
		stun = defaultSTUN
	}

	servers := []gin.H{{"urls": stun}}

	if len(config.C.TURNURLs) > 0 && config.C.TURNSecret != "" {
		username := fmt.Sprintf("%d:%s", time.Now().Add(turnCredentialTTL).Unix(), c.GetString("user_id"))
		mac := hmac.New(sha1.New, []byte(config.C.TURNSecret))
		mac.Write([]byte(username))
		servers = append(servers, gin.H{
			"urls":       config.C.TURNURLs,
			"username":   username,
			"credential": base64.StdEncoding.EncodeToString(mac.Sum(nil)),
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"ice_servers": servers,
		"ttl":         int(turnCredentialTTL.Seconds()),
		"turn":        len(servers) > 1,
	})
}
