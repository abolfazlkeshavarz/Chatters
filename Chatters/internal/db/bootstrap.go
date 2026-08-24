package db

import (
	"log"

	"messenger/internal/config"

	"golang.org/x/crypto/bcrypt"
)

// BootstrapAdmin creates or promotes the administrator described by the
// ADMIN_* environment variables. It is idempotent: an existing account is
// promoted rather than overwritten, so restarting the container never resets
// a password that has since been changed through the UI.
func BootstrapAdmin() error {
	username := config.C.AdminUsername
	password := config.C.AdminPassword

	if username == "" || password == "" {
		var admins int
		if err := DB.QueryRow(`SELECT COUNT(*) FROM users WHERE is_admin`).Scan(&admins); err == nil && admins == 0 {
			log.Println("bootstrap: no administrator exists; set ADMIN_USERNAME and ADMIN_PASSWORD to create one")
		}
		return nil
	}

	var exists bool
	if err := DB.QueryRow(`SELECT EXISTS (SELECT 1 FROM users WHERE id = $1)`, username).Scan(&exists); err != nil {
		return err
	}

	if exists {
		if _, err := DB.Exec(`UPDATE users SET is_admin = true WHERE id = $1`, username); err != nil {
			return err
		}
		log.Printf("bootstrap: promoted existing user %q to administrator", username)
		return nil
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	email := config.C.AdminEmail
	if email == "" {
		email = username + "@local"
	}

	if _, err := DB.Exec(
		`INSERT INTO users (id, email, password_hash, is_admin) VALUES ($1, $2, $3, true)`,
		username, email, string(hash),
	); err != nil {
		return err
	}

	log.Printf("bootstrap: created administrator %q", username)
	return nil
}
