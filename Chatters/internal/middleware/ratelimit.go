package middleware

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"messenger/internal/cache"

	"github.com/gin-gonic/gin"
)

// RateLimiter blunts credential stuffing against /login and account-spam
// against /register.
//
// With Redis configured, state is shared in Redis (a fixed-window counter:
// INCR the key for this client+window, EXPIRE it on first use, deny once it
// passes capacity) so the limit holds across every backend replica instead of
// being trivially bypassed by whichever one a request happens to land on.
//
// Without Redis it falls back to the in-memory token bucket this app always
// had, which is exactly right for a single process and needs nothing extra
// running for local development.
type RateLimiter struct {
	name     string
	capacity int
	window   time.Duration

	mu      sync.Mutex
	buckets map[string]*bucket
	refill  float64 // tokens per second, in-memory fallback only
}

type bucket struct {
	tokens float64
	seen   time.Time
}

func NewRateLimiter(name string, capacity int, per time.Duration) *RateLimiter {
	rl := &RateLimiter{
		name:     name,
		capacity: capacity,
		window:   per,
		buckets:  map[string]*bucket{},
		refill:   float64(capacity) / per.Seconds(),
	}
	go rl.reap()
	return rl
}

func (rl *RateLimiter) allow(ctx context.Context, key string) bool {
	if cache.Enabled() {
		allowed, err := rl.allowRedis(ctx, key)
		if err == nil {
			return allowed
		}
		// A Redis hiccup should degrade the request, not lock everyone out of
		// login. Fall through to the in-memory path for this one check.
		log.Printf("ratelimit: redis error, falling back to in-memory for this request: %v", err)
	}
	return rl.allowLocal(key)
}

func (rl *RateLimiter) allowRedis(ctx context.Context, key string) (bool, error) {
	redisKey := fmt.Sprintf("ratelimit:%s:%s", rl.name, key)

	n, err := cache.Client.Incr(ctx, redisKey).Result()
	if err != nil {
		return false, err
	}
	if n == 1 {
		// Only the request that just created the counter sets its lifetime,
		// so a fast series of INCRs cannot keep pushing the deadline out.
		if err := cache.Client.Expire(ctx, redisKey, rl.window).Err(); err != nil {
			return false, err
		}
	}
	return n <= int64(rl.capacity), nil
}

func (rl *RateLimiter) allowLocal(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	b, ok := rl.buckets[key]
	if !ok {
		rl.buckets[key] = &bucket{tokens: float64(rl.capacity) - 1, seen: now}
		return true
	}

	b.tokens += now.Sub(b.seen).Seconds() * rl.refill
	if b.tokens > float64(rl.capacity) {
		b.tokens = float64(rl.capacity)
	}
	b.seen = now

	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func (rl *RateLimiter) reap() {
	for range time.Tick(10 * time.Minute) {
		rl.mu.Lock()
		cutoff := time.Now().Add(-30 * time.Minute)
		for k, b := range rl.buckets {
			if b.seen.Before(cutoff) {
				delete(rl.buckets, k)
			}
		}
		rl.mu.Unlock()
	}
}

func (rl *RateLimiter) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !rl.allow(c.Request.Context(), c.ClientIP()) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "too many attempts, please wait and try again",
			})
			return
		}
		c.Next()
	}
}
