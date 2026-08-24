package db

import (
	"database/sql"
	"fmt"
	"time"

	"messenger/internal/config"

	_ "github.com/lib/pq"
)

var DB *sql.DB

func Connect() error {
	db, err := sql.Open("postgres", config.C.DatabaseURL)
	if err != nil {
		return fmt.Errorf("sql.Open error: %w", err)
	}

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(time.Hour)

	// Postgres may still be starting up when we are (compose healthchecks help
	// but do not guarantee readiness for the very first connection).
	var lastErr error
	for attempt := 0; attempt < 15; attempt++ {
		if lastErr = db.Ping(); lastErr == nil {
			DB = db
			return nil
		}
		time.Sleep(time.Second)
	}

	return fmt.Errorf("db.Ping error after retries: %w", lastErr)
}
