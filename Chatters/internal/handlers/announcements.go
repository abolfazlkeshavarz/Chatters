package handlers

import (
	"database/sql"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"messenger/internal/db"
	"messenger/internal/websocket"

	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
)

// Colours are rendered straight into the client's inline styles, so only a
// literal hex value is accepted — anything else would be an injection point.
var hexColorRe = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

type announcement struct {
	ID          int        `json:"id"`
	AuthorLabel string     `json:"author_label"`
	Title       string     `json:"title"`
	Body        string     `json:"body"`
	Color       string     `json:"color"`
	TextColor   string     `json:"text_color"`
	Icon        string     `json:"icon"`
	Priority    string     `json:"priority"`
	Dismissible bool       `json:"dismissible"`
	CreatedAt   time.Time  `json:"created_at"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
}

type adminAnnouncement struct {
	announcement
	CreatedBy *string  `json:"created_by,omitempty"`
	Active    bool     `json:"active"`
	Everyone  bool     `json:"everyone"`
	StartsAt  time.Time `json:"starts_at"`
	Targets   []string `json:"targets"`
	AckCount  int      `json:"ack_count"`
	Audience  int      `json:"audience"`
}

const defaultColor = "#2f6fed"
const defaultTextColor = "#ffffff"

func validPriority(p string) bool {
	switch p {
	case "low", "normal", "high", "critical":
		return true
	}
	return false
}

/* --------------------------------------------------------------- user side */

// MyAnnouncements returns the notices this user should see and has not yet
// acknowledged — what the banner above the chat list renders.
func MyAnnouncements(c *gin.Context) {
	userID := c.GetString("user_id")

	rows, err := db.DB.Query(
		`SELECT a.id, a.author_label, a.title, a.body, a.color, a.text_color,
		        a.icon, a.priority, a.dismissible, a.created_at, a.expires_at
		 FROM announcements a
		 WHERE a.active
		   AND a.starts_at <= now()
		   AND (a.expires_at IS NULL OR a.expires_at > now())
		   AND (a.everyone OR EXISTS (
		         SELECT 1 FROM announcement_targets t
		         WHERE t.announcement_id = a.id AND t.user_id = $1))
		   AND NOT EXISTS (
		         SELECT 1 FROM announcement_acks k
		         WHERE k.announcement_id = a.id AND k.user_id = $1)
		 ORDER BY
		   CASE a.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1
		                   WHEN 'normal' THEN 2 ELSE 3 END,
		   a.created_at DESC`,
		userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load announcements"})
		return
	}
	defer rows.Close()

	out := []announcement{}
	for rows.Next() {
		var a announcement
		var expires sql.NullTime
		if err := rows.Scan(
			&a.ID, &a.AuthorLabel, &a.Title, &a.Body, &a.Color, &a.TextColor,
			&a.Icon, &a.Priority, &a.Dismissible, &a.CreatedAt, &expires,
		); err != nil {
			continue
		}
		if expires.Valid {
			a.ExpiresAt = &expires.Time
		}
		out = append(out, a)
	}

	c.JSON(http.StatusOK, gin.H{"announcements": out})
}

// AckAnnouncement records the OK press. Idempotent, so a double-tap or a retry
// after a dropped response is not an error.
func AckAnnouncement(c *gin.Context) {
	userID := c.GetString("user_id")

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	if _, err := db.DB.Exec(
		`INSERT INTO announcement_acks (announcement_id, user_id) VALUES ($1, $2)
		 ON CONFLICT DO NOTHING`,
		id, userID,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to acknowledge"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

/* -------------------------------------------------------------- admin side */

// AdminListAnnouncements returns every notice with its delivery stats.
func AdminListAnnouncements(c *gin.Context) {
	rows, err := db.DB.Query(
		`SELECT a.id, a.created_by, a.author_label, a.title, a.body, a.color,
		        a.text_color, a.icon, a.priority, a.dismissible, a.active,
		        a.everyone, a.starts_at, a.expires_at, a.created_at,
		        COALESCE(ARRAY_AGG(t.user_id) FILTER (WHERE t.user_id IS NOT NULL), '{}') AS targets,
		        (SELECT COUNT(*) FROM announcement_acks k WHERE k.announcement_id = a.id) AS ack_count,
		        CASE WHEN a.everyone THEN (SELECT COUNT(*) FROM users)
		             ELSE (SELECT COUNT(*) FROM announcement_targets x WHERE x.announcement_id = a.id)
		        END AS audience
		 FROM announcements a
		 LEFT JOIN announcement_targets t ON t.announcement_id = a.id
		 GROUP BY a.id
		 ORDER BY a.created_at DESC
		 LIMIT 200`,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list announcements"})
		return
	}
	defer rows.Close()

	out := []adminAnnouncement{}
	for rows.Next() {
		var a adminAnnouncement
		var createdBy sql.NullString
		var expires sql.NullTime
		if err := rows.Scan(
			&a.ID, &createdBy, &a.AuthorLabel, &a.Title, &a.Body, &a.Color,
			&a.TextColor, &a.Icon, &a.Priority, &a.Dismissible, &a.Active,
			&a.Everyone, &a.StartsAt, &expires, &a.CreatedAt,
			pq.Array(&a.Targets), &a.AckCount, &a.Audience,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read announcements"})
			return
		}
		a.CreatedBy = nullStr(createdBy)
		if expires.Valid {
			a.ExpiresAt = &expires.Time
		}
		out = append(out, a)
	}

	c.JSON(http.StatusOK, gin.H{"announcements": out})
}

// AdminCreateAnnouncement publishes a notice to everyone or to named users.
func AdminCreateAnnouncement(c *gin.Context) {
	actor := c.GetString("user_id")

	var req struct {
		AuthorLabel string   `json:"author_label"`
		Title       string   `json:"title"`
		Body        string   `json:"body"`
		Color       string   `json:"color"`
		TextColor   string   `json:"text_color"`
		Icon        string   `json:"icon"`
		Priority    string   `json:"priority"`
		Dismissible *bool    `json:"dismissible"`
		Everyone    bool     `json:"everyone"`
		Targets     []string `json:"targets"`
		ExpiresAt   *string  `json:"expires_at"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	body := strings.TrimSpace(req.Body)
	if body == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "the message body is required"})
		return
	}
	if len(body) > 4000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "the message is too long"})
		return
	}

	// The admin signs the notice with whatever name they want users to see;
	// falling back to their username rather than leaving it blank, because an
	// unsigned announcement is exactly what a phishing one looks like.
	authorLabel := strings.TrimSpace(req.AuthorLabel)
	if authorLabel == "" {
		authorLabel = actor
	}
	if len(authorLabel) > 80 {
		authorLabel = authorLabel[:80]
	}

	title := strings.TrimSpace(req.Title)
	if len(title) > 200 {
		title = title[:200]
	}

	color := strings.TrimSpace(req.Color)
	if !hexColorRe.MatchString(color) {
		color = defaultColor
	}
	textColor := strings.TrimSpace(req.TextColor)
	if !hexColorRe.MatchString(textColor) {
		textColor = defaultTextColor
	}

	icon := strings.TrimSpace(req.Icon)
	if icon == "" {
		icon = "📢"
	}
	if len([]rune(icon)) > 4 {
		icon = string([]rune(icon)[:4])
	}

	priority := strings.TrimSpace(req.Priority)
	if !validPriority(priority) {
		priority = "normal"
	}

	dismissible := true
	if req.Dismissible != nil {
		dismissible = *req.Dismissible
	}

	var expiresAt *time.Time
	if req.ExpiresAt != nil && strings.TrimSpace(*req.ExpiresAt) != "" {
		t, err := time.Parse(time.RFC3339, *req.ExpiresAt)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "expires_at must be an RFC3339 timestamp"})
			return
		}
		expiresAt = &t
	}

	// De-duplicated and self-excluding is deliberate: an admin does not need
	// their own broadcast pinned over their own chat list.
	targets := []string{}
	if !req.Everyone {
		seen := map[string]bool{}
		for _, t := range req.Targets {
			t = strings.TrimSpace(t)
			if t == "" || seen[t] {
				continue
			}
			seen[t] = true
			targets = append(targets, t)
		}
		if len(targets) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "choose at least one recipient, or send to everyone"})
			return
		}
	}

	tx, err := db.DB.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}
	defer tx.Rollback()

	var id int
	err = tx.QueryRow(
		`INSERT INTO announcements
		   (created_by, author_label, title, body, color, text_color, icon,
		    priority, dismissible, everyone, expires_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		 RETURNING id`,
		actor, authorLabel, title, body, color, textColor, icon,
		priority, dismissible, req.Everyone, expiresAt,
	).Scan(&id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create the announcement"})
		return
	}

	for _, t := range targets {
		if _, err := tx.Exec(
			`INSERT INTO announcement_targets (announcement_id, user_id) VALUES ($1, $2)`,
			id, t,
		); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no such user: " + t})
			return
		}
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "commit failed"})
		return
	}

	// Push it to anyone already looking at the app, so a notice does not wait
	// for the next page load to appear.
	if websocket.GlobalHub != nil {
		payload := map[string]interface{}{"type": "announcement", "id": id}
		if req.Everyone {
			websocket.GlobalHub.BroadcastEventToAll(payload)
		} else {
			websocket.GlobalHub.BroadcastEventToMembers(targets, payload)
		}
	}

	auditLog(actor, "announcement.create", strconv.Itoa(id), title)
	c.JSON(http.StatusOK, gin.H{"status": "ok", "id": id})
}

// AdminUpdateAnnouncement toggles a notice on or off without deleting it, so
// the acknowledgement history survives.
func AdminUpdateAnnouncement(c *gin.Context) {
	actor := c.GetString("user_id")

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var req struct {
		Active *bool `json:"active"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Active == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	res, err := db.DB.Exec(`UPDATE announcements SET active = $1 WHERE id = $2`, *req.Active, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	auditLog(actor, "announcement.update", strconv.Itoa(id), "active="+strconv.FormatBool(*req.Active))
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func AdminDeleteAnnouncement(c *gin.Context) {
	actor := c.GetString("user_id")

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	res, err := db.DB.Exec(`DELETE FROM announcements WHERE id = $1`, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	auditLog(actor, "announcement.delete", strconv.Itoa(id), "")
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

// AdminAnnouncementReaders lists who has and has not pressed OK — the "did
// people actually see this" question the panel exists to answer.
func AdminAnnouncementReaders(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	rows, err := db.DB.Query(
		`SELECT u.id, k.acked_at IS NOT NULL, k.acked_at
		 FROM announcements a
		 JOIN users u ON (a.everyone OR EXISTS (
		        SELECT 1 FROM announcement_targets t
		        WHERE t.announcement_id = a.id AND t.user_id = u.id))
		 LEFT JOIN announcement_acks k ON k.announcement_id = a.id AND k.user_id = u.id
		 WHERE a.id = $1
		 ORDER BY (k.acked_at IS NOT NULL) DESC, u.id`,
		id,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load readers"})
		return
	}
	defer rows.Close()

	type reader struct {
		UserID  string     `json:"user_id"`
		Acked   bool       `json:"acked"`
		AckedAt *time.Time `json:"acked_at,omitempty"`
	}

	out := []reader{}
	for rows.Next() {
		var r reader
		var at sql.NullTime
		if err := rows.Scan(&r.UserID, &r.Acked, &at); err != nil {
			continue
		}
		if at.Valid {
			r.AckedAt = &at.Time
		}
		out = append(out, r)
	}

	c.JSON(http.StatusOK, gin.H{"readers": out})
}
