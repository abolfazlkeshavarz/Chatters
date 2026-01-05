package main

import (
	"messenger/internal/db"
	"messenger/internal/handlers"
	"messenger/internal/middleware"
	"messenger/internal/websocket"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func main() {
	db.Connect()

	r := gin.Default()

	// 🔧 Explicit OPTIONS handling (dev)
	r.Use(func(c *gin.Context) {
		if c.Request.Method == "OPTIONS" {
			c.Header("Access-Control-Allow-Origin", "http://localhost:3000")
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Authorization")
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// ✅ Dev CORS
	r.Use(cors.Default())

	// 🔓 Public routes
	r.POST("/register", handlers.Register)
	r.POST("/login", handlers.Login)

	// 🔌 WebSocket hub
	hub := websocket.NewHub()
	go hub.Run()

	// ✅ WebSocket route (NO middleware)
	r.GET("/api/ws", websocket.HandleWebSocket(hub))

	// 🔐 Protected REST routes
	protected := r.Group("/api")
	protected.Use(middleware.AuthMiddleware())
	{
		protected.GET("/me", func(c *gin.Context) {
			userID, _ := c.Get("user_id")
			c.JSON(200, gin.H{"user_id": userID})
		})
		
		protected.GET("/chats/:chatId/messages", handlers.GetMessages)
		protected.POST("/chats", handlers.CreateChat)
		protected.GET("/chats", handlers.GetChats)
		protected.POST("/chats/:id/members", handlers.AddMember)
		protected.PUT("/profile/username", handlers.ChangeUsername)
		protected.PUT("/profile/password", handlers.ChangePassword)
		protected.POST("/media", handlers.UploadMedia)
		protected.GET("/media/:id", handlers.DownloadMedia)


	}

	r.Run(":8080")
}
