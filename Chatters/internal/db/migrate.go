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

	// --- Message delivery state ---
	// Three states: sent -> delivered -> seen. Older databases only ever held
	// 'sent' and 'seen', both of which remain valid, so no data rewrite is
	// needed; this only normalises anything unexpected before the constraint
	// below would reject it.
	`UPDATE messages SET status = 'sent' WHERE status IS NULL OR status NOT IN ('sent','delivered','seen')`,
	`ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_status_check`,
	`ALTER TABLE messages ADD CONSTRAINT messages_status_check
		CHECK (status IN ('sent','delivered','seen'))`,

	// Backs the per-chat unread counts and the delivery sweep, both of which
	// filter on status.
	`CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(chat_id, status)`,

	`CREATE INDEX IF NOT EXISTS idx_chat_members_user_id ON chat_members(user_id)`,
	`CREATE INDEX IF NOT EXISTS idx_messages_chat_id_created ON messages(chat_id, created_at)`,
	`CREATE INDEX IF NOT EXISTS idx_message_keys_user ON message_keys(user_id)`,
	`CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id)`,

	// --- E2E encryption: consent handshake ---
	// e2e_enabled flips on only once the OTHER member accepts, so a chat can no
	// longer be silently upgraded by one side. 'accepted' implies e2e_enabled;
	// 'pending' means a request is awaiting a response; 'none' is the default.
	`ALTER TABLE chats ADD COLUMN IF NOT EXISTS e2e_status TEXT NOT NULL DEFAULT 'none'`,
	`ALTER TABLE chats ADD COLUMN IF NOT EXISTS e2e_requested_by TEXT REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE`,
	`ALTER TABLE chats ADD COLUMN IF NOT EXISTS e2e_requested_at TIMESTAMPTZ`,
	// Databases from before this handshake existed already have e2e_enabled
	// chats; they are grandfathered in as accepted rather than losing state.
	`UPDATE chats SET e2e_status = 'accepted' WHERE e2e_enabled AND e2e_status = 'none'`,
	`ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_e2e_status_check`,
	`ALTER TABLE chats ADD CONSTRAINT chats_e2e_status_check
		CHECK (e2e_status IN ('none','pending','accepted'))`,

	// --- Admin-configurable app settings (key/value) ---
	`CREATE TABLE IF NOT EXISTS app_settings (
		key        TEXT PRIMARY KEY,
		value      TEXT NOT NULL,
		updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`,

	// --- Per-user chat muting ---
	`CREATE TABLE IF NOT EXISTS chat_mutes (
		chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
		muted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		PRIMARY KEY (chat_id, user_id)
	)`,
	`CREATE INDEX IF NOT EXISTS idx_chat_mutes_user ON chat_mutes(user_id)`,

	// --- Contacts ---
	// One-directional, like Telegram: owner added contact, not necessarily the
	// other way around. Not a prerequisite for messaging someone (chats can
	// still be created by username directly) — this is purely what populates
	// the "New chat" / "New group" picker instead of typing a username blind.
	`CREATE TABLE IF NOT EXISTS contacts (
		owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
		contact_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
		created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		PRIMARY KEY (owner_id, contact_id),
		CHECK (owner_id <> contact_id)
	)`,
	`CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_id)`,

	// --- Profile photos ---
	// 'public' is visible to any signed-in user; 'contacts' only to someone on
	// either side of a contacts relationship with the owner. Chat membership
	// does NOT override this — a group mate is not automatically a contact,
	// and the visibility setting is a privacy choice the app has to honour
	// even inside a conversation the owner is already part of.
	`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_path TEXT`,
	`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_mime TEXT`,
	// Not just informational: the frontend appends this as a query string
	// (?v=<timestamp>) so a freshly replaced avatar gets a URL the browser has
	// never cached, rather than needing a manual cache-busting scheme.
	`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_updated_at TIMESTAMPTZ`,
	`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_visibility TEXT NOT NULL DEFAULT 'public'`,
	`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_avatar_visibility_check`,
	`ALTER TABLE users ADD CONSTRAINT users_avatar_visibility_check
		CHECK (avatar_visibility IN ('public','contacts'))`,
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
