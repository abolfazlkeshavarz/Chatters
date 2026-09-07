package websocket

import (
	"context"
	"log"
	"time"

	"messenger/internal/db"
)

// StartExpirySweep deletes self-destruct messages whose time has come and tells
// every open client to drop them. It runs on a short interval — a 5-second
// timer would feel broken on a 5-minute one — but each pass is a single
// indexed DELETE ... RETURNING, so the cost is negligible when nothing is due.
func StartExpirySweep(ctx context.Context, hub *Hub, interval time.Duration) {
	ticker := time.NewTicker(interval)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				sweepExpiredOnce(hub)
			}
		}
	}()
}

func sweepExpiredOnce(hub *Hub) {
	rows, err := db.DB.Query(
		`DELETE FROM messages
		 WHERE expires_at IS NOT NULL AND expires_at <= now()
		 RETURNING id, chat_id`,
	)
	if err != nil {
		log.Printf("self-destruct sweep failed: %v", err)
		return
	}
	defer rows.Close()

	byChat := map[string][]int{}
	for rows.Next() {
		var id int
		var chatID string
		if rows.Scan(&id, &chatID) == nil {
			byChat[chatID] = append(byChat[chatID], id)
		}
	}
	if len(byChat) == 0 || hub == nil {
		return
	}

	total := 0
	for chatID, ids := range byChat {
		total += len(ids)
		hub.BroadcastEvent(chatID, map[string]interface{}{
			"type":    "deleted",
			"chat_id": chatID,
			"ids":     ids,
		})
	}
	log.Printf("self-destruct sweep: removed %d expired message(s)", total)
}
