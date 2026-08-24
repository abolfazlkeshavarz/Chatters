package db

import "fmt"

// migrations are written to be idempotent so that they can run unconditionally
// on every boot. This keeps a brand-new container and a long-lived production
// database on the same code path — there is no separate "upgrade" procedure to
// remember, and no ordering state to get out of sync.
var migrations = []string{
	`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`,

	`CREATE TABLE IF NOT EXISTS users (
		id            TEXT PRIMARY KEY,
		email         TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
	)`,

	`CREATE TABLE IF NOT EXISTS chats (
		id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		is_group   BOOLEAN NOT NULL DEFAULT false,
		name       TEXT,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`,

	`CREATE TABLE IF NOT EXISTS chat_members (
		chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
		PRIMARY KEY (chat_id, user_id)
	)`,

	`CREATE TABLE IF NOT EXISTS messages (
		id         SERIAL PRIMARY KEY,
		chat_id    UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
		sender_id  TEXT REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
		content    TEXT,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		status     TEXT NOT NULL DEFAULT 'sent',
		reply_to   INTEGER REFERENCES messages(id) ON DELETE SET NULL,
		type       TEXT NOT NULL DEFAULT 'text',
		file_path  TEXT,
		filename   TEXT,
		mime_type  TEXT
	)`,

	`CREATE TABLE IF NOT EXISTS media_messages (
		id         INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
		chat_id    UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
		sender_id  TEXT REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
		file_path  TEXT,
		mime_type  TEXT,
		downloaded BOOLEAN NOT NULL DEFAULT false
	)`,

	// --- Admin + session invalidation ---
	`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false`,
	// Bumped whenever credentials change so previously issued JWTs stop working.
	`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0`,
	`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`,

	// --- End-to-end encryption key material ---
	// public_key is distributed to peers. The private key never leaves the
	// browser in cleartext: it is wrapped client-side with a key derived from
	// the user's password, so the server stores an opaque blob it cannot open.
	`ALTER TABLE users ADD COLUMN IF NOT EXISTS public_key TEXT`,
	`ALTER TABLE users ADD COLUMN IF NOT EXISTS encrypted_private_key TEXT`,
	`ALTER TABLE users ADD COLUMN IF NOT EXISTS key_salt TEXT`,
	`ALTER TABLE users ADD COLUMN IF NOT EXISTS key_nonce TEXT`,

	`ALTER TABLE chats ADD COLUMN IF NOT EXISTS e2e_enabled BOOLEAN NOT NULL DEFAULT false`,

	`ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN NOT NULL DEFAULT false`,
	`ALTER TABLE messages ADD COLUMN IF NOT EXISTS cipher_iv TEXT`,

	// One wrapped copy of a message's content key per recipient (ECIES).
	`CREATE TABLE IF NOT EXISTS message_keys (
		message_id    INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
		user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
		wrapped_key   TEXT NOT NULL,
		wrap_iv       TEXT NOT NULL,
		ephemeral_pub TEXT NOT NULL,
		PRIMARY KEY (message_id, user_id)
	)`,

	// --- Web Push subscriptions ---
	`CREATE TABLE IF NOT EXISTS push_subscriptions (
		id         SERIAL PRIMARY KEY,
		user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
		endpoint   TEXT NOT NULL UNIQUE,
		p256dh     TEXT NOT NULL,
		auth       TEXT NOT NULL,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`,

	`CREATE INDEX IF NOT EXISTS idx_chat_members_user_id ON chat_members(user_id)`,
	`CREATE INDEX IF NOT EXISTS idx_messages_chat_id_created ON messages(chat_id, created_at)`,
	`CREATE INDEX IF NOT EXISTS idx_message_keys_user ON message_keys(user_id)`,
	`CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id)`,
}

// renameCascades repoints foreign keys at users(id) so that renaming a user
// propagates instead of failing (or worse, orphaning rows). The original
// schema created these without ON UPDATE CASCADE, so existing databases need
// the constraint swapped out.
var renameCascades = []struct {
	table, constraint, column, onDelete string
}{
	{"chat_members", "chat_members_user_id_fkey", "user_id", "CASCADE"},
	{"messages", "messages_sender_id_fkey", "sender_id", "SET NULL"},
	{"media_messages", "media_messages_sender_id_fkey", "sender_id", "SET NULL"},
}

func Migrate() error {
	for _, stmt := range migrations {
		if _, err := DB.Exec(stmt); err != nil {
			return fmt.Errorf("migration failed (%.60s...): %w", stmt, err)
		}
	}

	for _, fk := range renameCascades {
		stmt := fmt.Sprintf(
			`ALTER TABLE %s DROP CONSTRAINT IF EXISTS %s,
			 ADD CONSTRAINT %s FOREIGN KEY (%s) REFERENCES users(id)
			 ON DELETE %s ON UPDATE CASCADE`,
			fk.table, fk.constraint, fk.constraint, fk.column, fk.onDelete,
		)
		if _, err := DB.Exec(stmt); err != nil {
			return fmt.Errorf("fk migration on %s failed: %w", fk.table, err)
		}
	}

	return nil
}
