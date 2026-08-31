package db

// Small key/value store for admin-configurable settings that do not warrant
// their own table or an env var (because they are meant to change at runtime,
// from the admin panel, without a restart).

const SettingE2ERetentionSeconds = "e2e_retention_seconds"

// GetSetting returns fallback if the key has never been set.
func GetSetting(key, fallback string) string {
	var value string
	if err := DB.QueryRow(`SELECT value FROM app_settings WHERE key = $1`, key).Scan(&value); err != nil {
		return fallback
	}
	return value
}

func SetSetting(key, value string) error {
	_, err := DB.Exec(
		`INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
		key, value,
	)
	return err
}

// IsChatMuted reports whether userID has muted chatID. Lives here rather than
// in the handlers package so the websocket package (which sends push
// notifications and must not import handlers) can call it too.
func IsChatMuted(chatID, userID string) bool {
	var ok bool
	DB.QueryRow(
		`SELECT EXISTS (SELECT 1 FROM chat_mutes WHERE chat_id = $1 AND user_id = $2)`,
		chatID, userID,
	).Scan(&ok)
	return ok
}
