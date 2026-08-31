package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"messenger/internal/cache"
	"messenger/internal/config"
	"messenger/internal/db"
	"messenger/internal/handlers"
	"messenger/internal/middleware"
	"messenger/internal/websocket"

	"github.com/gin-gonic/gin"
)

// healthcheck lets the container probe itself without shipping curl or wget in
// the runtime image.
func healthcheck() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	client := http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%s/healthz", port))
	if err != nil {
		os.Exit(1)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		os.Exit(1)
	}
	os.Exit(0)
}

func main() {
	probe := flag.Bool("healthcheck", false, "probe the running server and exit")
	flag.Parse()
	if *probe {
		healthcheck()
	}

	config.Load()

	// Optional: every caller downstream falls back to single-process behaviour
	// when Redis is not configured, so a connection failure here is fatal only
	// if REDIS_URL was actually set — an operator who set it clearly wants it
	// used, and silently running without it would hide a real config problem.
	if err := cache.Connect(context.Background()); err != nil {
		log.Fatalf("redis connection failed: %v", err)
	}

	if err := db.Connect(); err != nil {
		log.Fatalf("database connection failed: %v", err)
	}
	if err := db.Migrate(); err != nil {
		log.Fatalf("database migration failed: %v", err)
	}
	if err := db.BootstrapAdmin(); err != nil {
		log.Fatalf("admin bootstrap failed: %v", err)
	}

	// Runs for the life of the process; the ticker is stopped by the goroutine
	// itself on context cancellation, which never happens today (the process
	// exits instead) but keeps the function honest for tests and future use.
	db.StartE2ERetentionSweep(context.Background(), 5*time.Minute)

	r := gin.New()

	// Gin trusts every proxy by default, which means it believes whatever
	// X-Forwarded-For a client sends — letting anyone forge their source
	// address and walk straight past the rate limiter. Trust only the private
	// ranges the reverse proxy actually sits in.
	if err := r.SetTrustedProxies(config.C.TrustedProxies); err != nil {
		log.Fatalf("invalid TRUSTED_PROXIES: %v", err)
	}

	r.Use(gin.Logger(), gin.Recovery())
	r.Use(middleware.SecurityHeaders())
	r.Use(middleware.CORS())

	// Credential endpoints get a tighter budget than the rest of the API. Named
	// so their Redis keys (shared across replicas, when configured) cannot
	// collide with each other.
	authLimiter := middleware.NewRateLimiter("auth", 10, time.Minute)
	apiLimiter := middleware.NewRateLimiter("api", 300, time.Minute)

	r.GET("/healthz", func(c *gin.Context) {
		if err := db.DB.Ping(); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "degraded"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// 🔓 Public routes
	r.POST("/register", authLimiter.Middleware(), handlers.Register)
	r.POST("/login", authLimiter.Middleware(), handlers.Login)

	// 🔌 WebSocket hub
	hub := websocket.NewHub()
	go hub.Run()
	// A no-op without Redis; with it, this is what lets a message reach a
	// recipient connected to a different backend replica.
	go hub.StartPubSub(context.Background())

	// Authenticated by single-use ticket rather than the bearer token.
	r.GET("/api/ws", websocket.HandleWebSocket(hub))

	// 🔐 Protected REST routes
	protected := r.Group("/api", apiLimiter.Middleware(), middleware.AuthMiddleware())
	{
		protected.GET("/me", handlers.Me)
		protected.POST("/ws-ticket", handlers.IssueWSTicket)

		protected.GET("/contacts", handlers.ListContacts)
		protected.POST("/contacts", handlers.AddContact)
		protected.DELETE("/contacts/:id", handlers.RemoveContact)

		protected.GET("/chats", handlers.GetChats)
		protected.POST("/chats", handlers.CreateChat)
		protected.GET("/chats/:id/messages", handlers.GetMessages)
		protected.GET("/chats/:id/members", handlers.GetChatMembers)
		protected.POST("/chats/:id/members", handlers.AddMember)
		protected.GET("/chats/:id/keys", handlers.GetChatKeys)
		protected.POST("/chats/:id/e2e/request", handlers.RequestChatE2E)
		protected.POST("/chats/:id/e2e/accept", handlers.AcceptChatE2E)
		protected.POST("/chats/:id/e2e/reject", handlers.RejectChatE2E)
		protected.PUT("/chats/:id/mute", handlers.SetChatMute)

		protected.PUT("/profile/username", handlers.ChangeUsername)
		protected.PUT("/profile/password", handlers.ChangePassword)
		protected.POST("/profile/avatar", handlers.UploadAvatar)
		protected.DELETE("/profile/avatar", handlers.DeleteAvatar)
		protected.PUT("/profile/avatar-visibility", handlers.SetAvatarVisibility)
		protected.GET("/avatars/:id", handlers.GetAvatar)

		protected.POST("/keys", handlers.UploadKeys)
		protected.GET("/keys/me", handlers.GetMyKeys)

		protected.POST("/media", handlers.UploadMedia)
		protected.GET("/media/:id", handlers.DownloadMedia)

		protected.GET("/push/vapid-public-key", handlers.PushPublicKey)
		protected.POST("/push/subscribe", handlers.Subscribe)
		protected.POST("/push/unsubscribe", handlers.Unsubscribe)

		admin := protected.Group("/admin", middleware.AdminMiddleware())
		{
			admin.GET("/stats", handlers.AdminStats)
			admin.GET("/users", handlers.AdminListUsers)
			admin.POST("/users", handlers.AdminCreateUser)
			admin.DELETE("/users/:id", handlers.AdminDeleteUser)
			admin.PUT("/users/:id/password", handlers.AdminResetPassword)
			admin.PUT("/users/:id/role", handlers.AdminSetRole)

			admin.GET("/settings/e2e-retention", handlers.AdminGetE2ERetention)
			admin.PUT("/settings/e2e-retention", handlers.AdminSetE2ERetention)
			admin.POST("/e2e/purge-now", handlers.AdminPurgeE2EMessages)
		}
	}

	// No WriteTimeout on purpose: it would cap the lifetime of WebSocket
	// connections, which are meant to stay open indefinitely.
	srv := &http.Server{
		Addr:              ":" + config.C.Port,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	log.Printf("listening on %s", srv.Addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}
