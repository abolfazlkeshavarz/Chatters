package config

import (
	"log"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// Config holds every runtime setting, resolved once at startup.
type Config struct {
	Port            string
	DatabaseURL     string
	JWTSecret       []byte
	AllowedOrigins  []string
	UploadDir       string
	MaxUploadBytes  int64
	Production      bool
	VAPIDPublicKey  string
	VAPIDPrivateKey string
	VAPIDSubject    string
	AdminUsername   string
	AdminPassword   string
	AdminEmail      string
	TrustedProxies  []string
	RedisURL        string
}

var C Config

const defaultSecret = "CHANGE_THIS_SECRET"

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// Load resolves configuration from the environment. It is fatal for a
// production deployment to run with the placeholder JWT secret, so we refuse
// to start rather than silently signing tokens everyone knows the key to.
func Load() {
	production := strings.EqualFold(os.Getenv("GIN_MODE"), "release")

	secret := os.Getenv("JWT_SECRET")
	if secret == "" || secret == defaultSecret {
		if production {
			log.Fatal("JWT_SECRET must be set to a strong random value in production")
		}
		log.Println("WARNING: using the default development JWT secret; set JWT_SECRET before deploying")
		secret = defaultSecret
	}
	if production && len(secret) < 32 {
		log.Fatal("JWT_SECRET must be at least 32 characters in production")
	}

	maxUpload := int64(20 << 20) // 20 MiB, matches the nginx client_max_body_size
	if v := os.Getenv("MAX_UPLOAD_BYTES"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			maxUpload = n
		}
	}

	C = Config{
		Port:            env("PORT", "8080"),
		DatabaseURL:     databaseURL(),
		JWTSecret:       []byte(secret),
		AllowedOrigins:  allowedOrigins(),
		UploadDir:       env("UPLOAD_DIR", "private_uploads"),
		MaxUploadBytes:  maxUpload,
		Production:      production,
		VAPIDPublicKey:  os.Getenv("VAPID_PUBLIC_KEY"),
		VAPIDPrivateKey: os.Getenv("VAPID_PRIVATE_KEY"),
		VAPIDSubject:    env("VAPID_SUBJECT", "mailto:admin@example.com"),
		AdminUsername:   os.Getenv("ADMIN_USERNAME"),
		AdminPassword:   os.Getenv("ADMIN_PASSWORD"),
		AdminEmail:      os.Getenv("ADMIN_EMAIL"),
		TrustedProxies:  trustedProxies(),
		RedisURL:        os.Getenv("REDIS_URL"),
	}
}

// trustedProxies lists the networks whose X-Forwarded-For header may be
// believed. Defaults to the RFC1918 ranges, which covers the nginx container
// in front of us; override when the proxy lives elsewhere.
func trustedProxies() []string {
	if raw := os.Getenv("TRUSTED_PROXIES"); raw != "" {
		var out []string
		for _, p := range strings.Split(raw, ",") {
			if p = strings.TrimSpace(p); p != "" {
				out = append(out, p)
			}
		}
		return out
	}

	return []string{
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",
		"127.0.0.0/8",
		"::1/128",
		"fc00::/7",
	}
}

// databaseURL assembles the connection string with url.URL rather than string
// concatenation. A strong password routinely contains characters that are
// syntactically meaningful in a URL — "openssl rand -base64" alone emits "+",
// "/" and "=" — and pasting those in raw either fails to parse or, worse,
// silently reinterprets part of the password as the host or path.
func databaseURL() string {
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		return dsn
	}

	u := url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(env("DB_USER", "postgres"), env("DB_PASSWORD", "admin")),
		Host:   net.JoinHostPort(env("DB_HOST", "localhost"), env("DB_PORT", "5432")),
		Path:   "/" + env("DB_NAME", "messenger"),
	}

	q := url.Values{}
	q.Set("sslmode", env("DB_SSLMODE", "disable"))
	u.RawQuery = q.Encode()

	return u.String()
}

// allowedOrigins is the extra browser-origin allowlist shared by CORS and the
// WebSocket upgrader. Same-origin requests are always allowed on top of this,
// so the Docker/nginx deployment (SPA and API behind one hostname) needs no
// configuration at all. In development we also permit the CRA dev server.
func allowedOrigins() []string {
	raw := os.Getenv("ALLOWED_ORIGINS")
	if raw == "" {
		raw = os.Getenv("FRONTEND_ORIGIN")
	}

	var out []string
	for _, o := range strings.Split(raw, ",") {
		if o = strings.TrimSuffix(strings.TrimSpace(o), "/"); o != "" {
			out = append(out, o)
		}
	}

	if !strings.EqualFold(os.Getenv("GIN_MODE"), "release") {
		out = append(out, "http://localhost:3000", "http://127.0.0.1:3000")
	}
	return out
}

// OriginAllowed reports whether a browser Origin header may talk to the API.
// host is the request's Host header: an Origin pointing at the same host is
// same-origin and always allowed, which covers the reverse-proxy deployment
// without anyone having to enumerate their domain in the environment.
func OriginAllowed(origin, host string) bool {
	if origin == "" {
		// Not a browser cross-origin request (curl, native client, or a
		// same-origin GET). Nothing to authorise here; the bearer token is
		// still required by the auth middleware.
		return true
	}

	if u, err := url.Parse(origin); err == nil && u.Host != "" {
		if strings.EqualFold(u.Host, host) {
			return true
		}
	}

	// Normalise both sides here rather than trusting the loader to have done
	// it, so the check is correct however AllowedOrigins was populated.
	origin = strings.TrimSuffix(origin, "/")
	for _, allowed := range C.AllowedOrigins {
		if strings.EqualFold(strings.TrimSuffix(strings.TrimSpace(allowed), "/"), origin) {
			return true
		}
	}
	return false
}
