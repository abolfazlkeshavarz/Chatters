package db

import (
	"context"
	"log"
	"strconv"
	"time"
)

// StartE2ERetentionSweep periodically deletes messages from end-to-end
// encrypted chats older than the admin-configured retention window. A value
// of 0 (the default) disables it — encrypted messages are then kept
// indefinitely, same as normal ones.
//
// message_keys rows cascade-delete with their message, so a sweep also
// reclaims the wrapped per-recipient keys; nothing else references them.
func StartE2ERetentionSweep(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				sweepE2ERetentionOnce()
			}
		}
	}()
}

func sweepE2ERetentionOnce() {
	seconds, err := strconv.Atoi(GetSetting(SettingE2ERetentionSeconds, "0"))
	if err != nil || seconds <= 0 {
		return
	}

	res, err := DB.Exec(
		`DELETE FROM messages
		 WHERE chat_id IN (SELECT id FROM chats WHERE e2e_enabled)
		   AND created_at < now() - ($1 || ' seconds')::interval`,
		seconds,
	)
	if err != nil {
		log.Printf("e2e retention sweep failed: %v", err)
		return
	}
	if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("e2e retention sweep: deleted %d expired encrypted message(s)", n)
	}
}

// PurgeAllE2EMessages deletes every message in every end-to-end encrypted
// chat immediately, regardless of age. The chats themselves and their
// encrypted status are left intact — only their content is cleared. Used by
// the admin "delete all E2E chats now" action.
func PurgeAllE2EMessages() (int64, error) {
	res, err := DB.Exec(`DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE e2e_enabled)`)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}
