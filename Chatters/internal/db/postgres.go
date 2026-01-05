package db

import (
	"database/sql"

	_ "github.com/lib/pq"
)

var DB *sql.DB

func Connect() error {
	dsn := "postgres://postgres:admin@localhost:5432/messenger?sslmode=disable"
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return err
	}
	DB = db
	return db.Ping()
}
