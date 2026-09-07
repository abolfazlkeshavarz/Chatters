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

	// --- Native app push tokens (Expo / FCM / APNs via Expo) ---
	// One row per app install. The token is the primary key so re-registering
	// after a re-login moves the device to the current user instead of failing.
	`CREATE TABLE IF NOT EXISTS device_push_tokens (
		token      TEXT PRIMARY KEY,
		user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
		platform   TEXT NOT NULL DEFAULT 'expo',
		created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`,
	`CREATE INDEX IF NOT EXISTS idx_device_push_tokens_user ON device_push_tokens(user_id)`,

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

	// --- Message deletion ---
	// "Delete for me" is a per-user tombstone: the row stays for other members,
	// but every query that returns a user their messages filters these out.
	// "Delete for everyone" hard-deletes the row and is broadcast so open
	// clients drop it live.
	`CREATE TABLE IF NOT EXISTS message_deletions (
		message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
		user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
		deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
		PRIMARY KEY (message_id, user_id)
	)`,
	`CREATE INDEX IF NOT EXISTS idx_message_deletions_user ON message_deletions(user_id)`,

	// --- Secret chats (Telegram-style) ---
	// A dedicated 1:1 encrypted conversation, created by the request/accept
	// handshake as its OWN chat rather than by upgrading an existing one in
	// place. Legacy in-place e2e_enabled 1:1 chats are back-filled as secret so
	// they keep behaving the same.
	`ALTER TABLE chats ADD COLUMN IF NOT EXISTS is_secret BOOLEAN NOT NULL DEFAULT false`,
	`UPDATE chats SET is_secret = true WHERE e2e_enabled AND NOT is_group`,

	// Self-destruct timer for a secret chat, in seconds; 0 = off. Either member
	// may change it; it applies to messages sent afterwards.
	`ALTER TABLE chats ADD COLUMN IF NOT EXISTS self_destruct_seconds INTEGER NOT NULL DEFAULT 0`,

	// When set, a background sweep deletes the message at this time and tells
	// open clients. Stamped at insert from the chat's self_destruct_seconds.
	`ALTER TABLE messages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`,
	`CREATE INDEX IF NOT EXISTS idx_messages_expires_at ON messages(expires_at) WHERE expires_at IS NOT NULL`,

	// 'system' messages carry a server-rendered notice (timer changed, …) with
	// no sender. The column had no CHECK constraint, so this is just documenting
	// the new value.

	// --- Phone numbers ---
	// Stored in a normalised form (digits, optional leading +) so a lookup by
	// phone is an equality test rather than a fuzzy match. UNIQUE because it is
	// an identifier people are found by, exactly like the email.
	//
	// phone_verified gates whether the number is usable for discovery: a number
	// a user typed themselves is unverified until an administrator approves the
	// pending request, so nobody can claim someone else's number and be found
	// as them.
	`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT`,
	`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT false`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE phone IS NOT NULL`,

	// A user asking to set or change their number. Exactly one row per user may
	// be pending at a time (partial unique index), so a spammed form cannot
	// bury the admin queue.
	`CREATE TABLE IF NOT EXISTS phone_requests (
		id           SERIAL PRIMARY KEY,
		user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
		phone        TEXT NOT NULL,
		status       TEXT NOT NULL DEFAULT 'pending',
		note         TEXT,
		created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
		decided_at   TIMESTAMPTZ,
		decided_by   TEXT REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
	)`,
	`ALTER TABLE phone_requests DROP CONSTRAINT IF EXISTS phone_requests_status_check`,
	`ALTER TABLE phone_requests ADD CONSTRAINT phone_requests_status_check
		CHECK (status IN ('pending','approved','rejected'))`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_phone_requests_one_pending
		ON phone_requests(user_id) WHERE status = 'pending'`,
	`CREATE INDEX IF NOT EXISTS idx_phone_requests_status ON phone_requests(status, created_at)`,

	// --- Registration requests (signup needs admin approval) ---
	// Signing up no longer creates a user. It records the request — password
	// already hashed, key bundle already wrapped client-side — and an
	// administrator turns it into an account. The bundle is carried through
	// verbatim so the approved account keeps the key pair the browser generated
	// at signup, and the user's existing password still unwraps it.
	`CREATE TABLE IF NOT EXISTS registration_requests (
		id                    SERIAL PRIMARY KEY,
		username              TEXT NOT NULL,
		email                 TEXT NOT NULL,
		phone                 TEXT,
		password_hash         TEXT NOT NULL,
		public_key            TEXT,
		encrypted_private_key TEXT,
		key_salt              TEXT,
		key_nonce             TEXT,
		status                TEXT NOT NULL DEFAULT 'pending',
		reason                TEXT,
		created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
		decided_at            TIMESTAMPTZ,
		decided_by            TEXT REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
	)`,
	`ALTER TABLE registration_requests DROP CONSTRAINT IF EXISTS registration_requests_status_check`,
	`ALTER TABLE registration_requests ADD CONSTRAINT registration_requests_status_check
		CHECK (status IN ('pending','approved','rejected'))`,
	// One live request per desired username / email, so the queue cannot be
	// flooded with duplicates of the same signup.
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_regreq_pending_username
		ON registration_requests(lower(username)) WHERE status = 'pending'`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_regreq_pending_email
		ON registration_requests(lower(email)) WHERE status = 'pending'`,
	`CREATE INDEX IF NOT EXISTS idx_regreq_status ON registration_requests(status, created_at DESC)`,

	// --- Public file / media library ---
	// A shared board any signed-in user can post to, separate from chats.
	// visibility 'public' is readable by every signed-in user; 'private'
	// requires the password the uploader set (bcrypt-hashed, never returned).
	// Administrators bypass the password — the panel can open anything.
	`CREATE TABLE IF NOT EXISTS public_files (
		id            SERIAL PRIMARY KEY,
		owner_id      TEXT REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
		title         TEXT NOT NULL DEFAULT '',
		description   TEXT NOT NULL DEFAULT '',
		filename      TEXT NOT NULL,
		file_path     TEXT NOT NULL,
		mime_type     TEXT NOT NULL DEFAULT 'application/octet-stream',
		size_bytes    BIGINT NOT NULL DEFAULT 0,
		visibility    TEXT NOT NULL DEFAULT 'public',
		password_hash TEXT,
		download_count INTEGER NOT NULL DEFAULT 0,
		created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
	)`,
	`ALTER TABLE public_files DROP CONSTRAINT IF EXISTS public_files_visibility_check`,
	`ALTER TABLE public_files ADD CONSTRAINT public_files_visibility_check
		CHECK (visibility IN ('public','private'))`,
	// A private row without a password would be unopenable by anyone but an
	// admin, which is never what the uploader meant.
	`ALTER TABLE public_files DROP CONSTRAINT IF EXISTS public_files_private_needs_password`,
	`ALTER TABLE public_files ADD CONSTRAINT public_files_private_needs_password
		CHECK (visibility <> 'private' OR password_hash IS NOT NULL)`,
	`CREATE INDEX IF NOT EXISTS idx_public_files_created ON public_files(created_at DESC)`,
	`CREATE INDEX IF NOT EXISTS idx_public_files_owner ON public_files(owner_id)`,

	// --- Admin announcements ---
	// A dismissible notice pinned above the chat list — not a chat message.
	// author_label is what the admin wants signed on it ("Support", a real
	// name, …) rather than their raw username; color/accent let the panel
	// style it.
	`CREATE TABLE IF NOT EXISTS announcements (
		id           SERIAL PRIMARY KEY,
		created_by   TEXT REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
		author_label TEXT NOT NULL DEFAULT '',
		title        TEXT NOT NULL DEFAULT '',
		body         TEXT NOT NULL,
		color        TEXT NOT NULL DEFAULT '#2f6fed',
		text_color   TEXT NOT NULL DEFAULT '#ffffff',
		icon         TEXT NOT NULL DEFAULT '📢',
		priority     TEXT NOT NULL DEFAULT 'normal',
		dismissible  BOOLEAN NOT NULL DEFAULT true,
		active       BOOLEAN NOT NULL DEFAULT true,
		everyone     BOOLEAN NOT NULL DEFAULT true,
		starts_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
		expires_at   TIMESTAMPTZ,
		created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
	)`,
	`ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_priority_check`,
	`ALTER TABLE announcements ADD CONSTRAINT announcements_priority_check
		CHECK (priority IN ('low','normal','high','critical'))`,

	// Empty for an "everyone" announcement; otherwise the explicit audience.
	`CREATE TABLE IF NOT EXISTS announcement_targets (
		announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
		user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
		PRIMARY KEY (announcement_id, user_id)
	)`,

	// One row per person who pressed OK. Doubles as the read receipt the panel
	// reports on, which is why it is not just a client-side flag.
	`CREATE TABLE IF NOT EXISTS announcement_acks (
		announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
		user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
		acked_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
		PRIMARY KEY (announcement_id, user_id)
	)`,
	`CREATE INDEX IF NOT EXISTS idx_announcement_acks_user ON announcement_acks(user_id)`,
	`CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(active, starts_at)`,

	// --- Admin audit log ---
	// Every destructive or privacy-sensitive panel action lands here so the
	// "who deleted that chat" question has an answer.
	`CREATE TABLE IF NOT EXISTS admin_audit_log (
		id         SERIAL PRIMARY KEY,
		actor_id   TEXT REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
		action     TEXT NOT NULL,
		target     TEXT NOT NULL DEFAULT '',
		detail     TEXT NOT NULL DEFAULT '',
		created_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`,
	`CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at DESC)`,

	// --- Last-seen tracking, for the panel's user detail view ---
	`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ`,

	// --- Soft deletion, so an administrator can still reach what users removed ---
	//
	// "Delete for everyone" used to DELETE the row. It now stamps deleted_at
	// instead: every user-facing query filters on it, so nothing changes for
	// the people in the conversation, while the moderation panel can still
	// produce the message or chat afterwards. Attachments are kept on disk for
	// the same reason — deleting the file would leave the admin a row naming
	// evidence that no longer exists.
	//
	// This is a real privacy trade: "delete for everyone" now means "hidden
	// from everyone but the operator", which is why the client wording says so.
	// AdminDeleteChat / AdminDeleteMessage remain hard deletes — that is the
	// path that genuinely destroys data, and it is the operator's to choose.
	`ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
	`ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_by TEXT REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE`,
	`CREATE INDEX IF NOT EXISTS idx_messages_deleted_at ON messages(deleted_at) WHERE deleted_at IS NOT NULL`,

	`ALTER TABLE chats ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
	`ALTER TABLE chats ADD COLUMN IF NOT EXISTS deleted_by TEXT REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE`,
	`CREATE INDEX IF NOT EXISTS idx_chats_deleted_at ON chats(deleted_at) WHERE deleted_at IS NOT NULL`,

	// Members are removed from chat_members when they leave, which would erase
	// who was in a deleted conversation. Snapshot them so the panel can still
	// say who the participants were.
	`CREATE TABLE IF NOT EXISTS chat_member_history (
		chat_id  UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
		user_id  TEXT NOT NULL,
		left_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
		PRIMARY KEY (chat_id, user_id)
	)`,

	// --- One direct chat per pair ---
	// Two people were able to accumulate unlimited 1:1 conversations by both
	// pressing "new chat", which split their history across duplicates. A
	// partial unique index on the ordered member pair is what makes that
	// impossible rather than merely unlikely: the handler also looks first, but
	// two simultaneous requests would both find nothing and both insert.
	//
	// Secret chats are excluded — a separate encrypted conversation alongside
	// the normal one is the entire point of them — as are group and
	// soft-deleted rows.
	`CREATE TABLE IF NOT EXISTS direct_chat_pairs (
		chat_id UUID PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
		user_a  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
		user_b  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
		CHECK (user_a < user_b)
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_direct_chat_pair ON direct_chat_pairs(user_a, user_b)`,

	// Back-fill from the chats that already exist, keeping the oldest of any
	// duplicate set — the one most likely to hold the real history. Later
	// duplicates are left alone rather than merged: silently moving somebody's
	// messages between conversations is not a migration's decision to make.
	`INSERT INTO direct_chat_pairs (chat_id, user_a, user_b)
	 SELECT DISTINCT ON (LEAST(m1.user_id, m2.user_id), GREATEST(m1.user_id, m2.user_id))
	        c.id,
	        LEAST(m1.user_id, m2.user_id),
	        GREATEST(m1.user_id, m2.user_id)
	 FROM chats c
	 JOIN chat_members m1 ON m1.chat_id = c.id
	 JOIN chat_members m2 ON m2.chat_id = c.id AND m2.user_id > m1.user_id
	 WHERE NOT c.is_group AND NOT c.is_secret AND c.deleted_at IS NULL
	   AND (SELECT COUNT(*) FROM chat_members x WHERE x.chat_id = c.id) = 2
	 ORDER BY LEAST(m1.user_id, m2.user_id), GREATEST(m1.user_id, m2.user_id), c.created_at
	 ON CONFLICT DO NOTHING`,
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
