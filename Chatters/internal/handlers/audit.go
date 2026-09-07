package handlers

import (
	"log"

	"messenger/internal/db"
)

// auditLog records a privileged action so the panel can answer "who did this".
//
// Deliberately best-effort: an audit write failing must never turn a
// successful moderation action into an error the admin has to retry (which
// would risk applying it twice). A failure is logged for the operator instead.
func auditLog(actor, action, target, detail string) {
	if _, err := db.DB.Exec(
		`INSERT INTO admin_audit_log (actor_id, action, target, detail)
		 VALUES ($1, $2, $3, $4)`,
		actor, action, target, detail,
	); err != nil {
		log.Printf("audit log write failed (%s %s %s): %v", actor, action, target, err)
	}
}
