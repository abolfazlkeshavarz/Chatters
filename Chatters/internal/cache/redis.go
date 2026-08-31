// Package cache wraps an optional Redis connection.
//
// Redis is what turns this app from "one process can serve everyone" into
// "any number of backend replicas can serve everyone": rate limits and
// WebSocket tickets become shared state instead of living in one process's
// memory, and the WebSocket hub uses Redis Pub/Sub so a message from a user
// connected to replica A reaches a recipient connected to replica B.
//
// It is deliberately optional. With REDIS_URL unset, every caller in this
// codebase falls back to the single-process, in-memory behaviour this app
// already had — so `go run ./cmd/server` with nothing but Postgres keeps
// working for local development, and Redis only has to be understood once you
// actually need more than one backend replica.
package cache

import (
	"context"
	"log"
	"time"

	"messenger/internal/config"

	"github.com/redis/go-redis/v9"
)

// Client is nil when Redis is not configured. Every caller must check for
// that (or use the helpers below, which already do).
var Client *redis.Client

// Connect is a no-op if REDIS_URL is unset. Otherwise it connects and blocks
// briefly retrying, the same tolerance db.Connect gives Postgres for a
// container that is still starting up.
func Connect(ctx context.Context) error {
	if config.C.RedisURL == "" {
		log.Println("cache: REDIS_URL not set, running single-instance (rate limits and WS tickets are in-memory only)")
		return nil
	}

	opts, err := redis.ParseURL(config.C.RedisURL)
	if err != nil {
		return err
	}
	client := redis.NewClient(opts)

	var lastErr error
	for attempt := 0; attempt < 15; attempt++ {
		pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		lastErr = client.Ping(pingCtx).Err()
		cancel()
		if lastErr == nil {
			Client = client
			log.Println("cache: connected to Redis")
			return nil
		}
		time.Sleep(time.Second)
	}

	return lastErr
}

// Enabled reports whether Redis is available. Callers use this to choose
// between the shared and in-memory implementation of whatever they do.
func Enabled() bool {
	return Client != nil
}
