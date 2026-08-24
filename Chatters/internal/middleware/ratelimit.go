package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// RateLimiter is a fixed-cost token bucket keyed by client IP. It exists to
// blunt credential stuffing against /login and account-spam against /register.
// State is per-process, which is fine for a single backend container; behind
// multiple replicas you would want Redis instead.
type RateLimiter struct {
	mu       sync.Mutex
	buckets  map[string]*bucket
	capacity float64
	refill   float64 // tokens per second
}

type bucket struct {
	tokens float64
	seen   time.Time
}

func NewRateLimiter(capacity int, per time.Duration) *RateLimiter {
	rl := &RateLimiter{
		buckets:  map[string]*bucket{},
		capacity: float64(capacity),
		refill:   float64(capacity) / per.Seconds(),
	}
	go rl.reap()
	return rl
}

func (rl *RateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	b, ok := rl.buckets[key]
	if !ok {
		rl.buckets[key] = &bucket{tokens: rl.capacity - 1, seen: now}
		return true
	}

	b.tokens += now.Sub(b.seen).Seconds() * rl.refill
	if b.tokens > rl.capacity {
		b.tokens = rl.capacity
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
		if !rl.allow(c.ClientIP()) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "too many attempts, please wait and try again",
			})
			return
		}
		c.Next()
	}
}
