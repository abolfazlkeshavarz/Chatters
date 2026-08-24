package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

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

	if err := db.Connect(); err != nil {
		log.Fatalf("database connection failed: %v", err)
	}
	if err := db.Migrate(); err != nil {
		log.Fatalf("database migration failed: %v", err)
	}
	if err := db.BootstrapAdmin(); err != nil {
		log.Fatalf("admin bootstrap failed: %v", err)
	}

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

	// Credential endpoints get a tighter budget than the rest of the API.
	authLimiter := middleware.NewRateLimiter(10, time.Minute)
	apiLimiter := middleware.NewRateLimiter(300, time.Minute)

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

	// Authenticated by single-use ticket rather than the bearer token.
	r.GET("/api/ws", websocket.HandleWebSocket(hub))

	// 🔐 Protected REST routes
	protected := r.Group("/api", apiLimiter.Middleware(), middleware.AuthMiddleware())
	{
		protected.GET("/me", handlers.Me)
		protected.POST("/ws-ticket", handlers.IssueWSTicket)

		protected.GET("/chats", handlers.GetChats)
		protected.POST("/chats", handlers.CreateChat)
		protected.GET("/chats/:id/messages", handlers.GetMessages)
		protected.GET("/chats/:id/members", handlers.GetChatMembers)
		protected.POST("/chats/:id/members", handlers.AddMember)
		protected.GET("/chats/:id/keys", handlers.GetChatKeys)
		protected.PUT("/chats/:id/e2e", handlers.SetChatE2E)

		protected.PUT("/profile/username", handlers.ChangeUsername)
		protected.PUT("/profile/password", handlers.ChangePassword)

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
