package db

import (
	"database/sql"
	"fmt"

	_ "github.com/lib/pq"
)

var DB *sql.DB

func Connect() error {
	dsn := "postgres://postgres:admin@localhost:5432/messenger?sslmode=disable"

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return fmt.Errorf("sql.Open error: %w", err)
	}

	if err := db.Ping(); err != nil {
		return fmt.Errorf("db.Ping error: %w", err)
	}

	DB = db
	return nil
}
