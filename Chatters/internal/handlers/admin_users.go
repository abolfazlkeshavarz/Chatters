package handlers

import (
	"database/sql"
	"net/http"
	"os"
	"strconv"
	"time"

	"messenger/internal/db"

	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
)

// AdminGetMedia serves any chat attachment without the membership check
// DownloadMedia enforces.
//
// This is the deliberate difference between the panel and the app: an
// administrator could already read every message body, and being able to see
// only an attachment's *name* while moderating was a gap, not a privacy
// guarantee. End-to-end encrypted message bodies remain unreadable — the
// server has no key for those, and no endpoint can change that.
func AdminGetMedia(c *gin.Context) {
	actor := c.GetString("user_id")

	mediaID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid media id"})
		return
	}

	var path, filename, mimeType string
	err = db.DB.QueryRow(
		`SELECT m.file_path,
		        COALESCE(m.filename, 'file'),
		        COALESCE(m.mime_type, 'application/octet-stream')
		 FROM messages m
		 WHERE m.id = $1 AND m.file_path IS NOT NULL`,
		mediaID,
	).Scan(&path, &filename, &mimeType)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "media not found"})
		return
	}

	if !withinUploadDir(path) {
		c.JSON(http.StatusNotFound, gin.H{"error": "media not found"})
		return
	}
	if _, err := os.Stat(path); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "media not found"})
		return
	}

	auditLog(actor, "media.view", strconv.Itoa(mediaID), filename)

	c.Header("Content-Type", mimeType)
	c.Header("X-Content-Type-Options", "nosniff")
	c.FileAttachment(path, filename)
}

type adminUserDetail struct {
	ID               string     `json:"id"`
	Email            string     `json:"email"`
	Phone            *string    `json:"phone,omitempty"`
	PhoneVerified    bool       `json:"phone_verified"`
	IsAdmin          bool       `json:"is_admin"`
	HasKeys          bool       `json:"has_keys"`
	HasAvatar        bool       `json:"has_avatar"`
	AvatarVisibility string     `json:"avatar_visibility"`
	CreatedAt        time.Time  `json:"created_at"`
	LastSeenAt       *time.Time `json:"last_seen_at,omitempty"`
	TokenVersion     int        `json:"token_version"`

	ChatCount     int      `json:"chat_count"`
	MessageCount  int      `json:"message_count"`
	MediaCount    int      `json:"media_count"`
	ContactCount  int      `json:"contact_count"`
	PublicFiles   int      `json:"public_file_count"`
	SecretChats   int      `json:"secret_chat_count"`
	PushDevices   int      `json:"push_device_count"`
	Contacts      []string `json:"contacts"`
	PendingPhone  *string  `json:"pending_phone,omitempty"`
}

// AdminGetUser returns everything the panel knows about one account, including
// the fields the user marked private (avatar visibility is reported, and the
// image itself is reachable through the normal avatar endpoint, which lets
// admins through).
func AdminGetUser(c *gin.Context) {
	target := c.Param("id")

	var u adminUserDetail
	var phone, avatarVisibility, pendingPhone sql.NullString
	var lastSeen sql.NullTime

	err := db.DB.QueryRow(
		`SELECT u.id, u.email, u.phone, u.phone_verified, u.is_admin,
		        u.public_key IS NOT NULL AND u.public_key <> '',
		        u.avatar_path IS NOT NULL AND u.avatar_path <> '',
		        u.avatar_visibility, u.created_at, u.last_seen_at, u.token_version,
		        (SELECT COUNT(*) FROM chat_members cm WHERE cm.user_id = u.id),
		        (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id),
		        (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id AND m.file_path IS NOT NULL),
		        (SELECT COUNT(*) FROM contacts ct WHERE ct.owner_id = u.id),
		        (SELECT COUNT(*) FROM public_files pf WHERE pf.owner_id = u.id),
		        (SELECT COUNT(*) FROM chat_members cm JOIN chats ch ON ch.id = cm.chat_id
		          WHERE cm.user_id = u.id AND ch.is_secret),
		        (SELECT COUNT(*) FROM device_push_tokens d WHERE d.user_id = u.id),
		        COALESCE((SELECT ARRAY_AGG(ct.contact_id) FROM contacts ct WHERE ct.owner_id = u.id), '{}'),
		        (SELECT p.phone FROM phone_requests p
		          WHERE p.user_id = u.id AND p.status = 'pending' LIMIT 1)
		 FROM users u WHERE u.id = $1`,
		target,
	).Scan(
		&u.ID, &u.Email, &phone, &u.PhoneVerified, &u.IsAdmin,
		&u.HasKeys, &u.HasAvatar, &avatarVisibility, &u.CreatedAt, &lastSeen, &u.TokenVersion,
		&u.ChatCount, &u.MessageCount, &u.MediaCount, &u.ContactCount,
		&u.PublicFiles, &u.SecretChats, &u.PushDevices,
		pq.Array(&u.Contacts), &pendingPhone,
	)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	u.Phone = nullStr(phone)
	u.PendingPhone = nullStr(pendingPhone)
	u.AvatarVisibility = avatarVisibility.String
	if lastSeen.Valid {
		u.LastSeenAt = &lastSeen.Time
	}

	c.JSON(http.StatusOK, gin.H{"user": u})
}

type auditEntry struct {
	ID        int       `json:"id"`
	Actor     *string   `json:"actor,omitempty"`
	Action    string    `json:"action"`
	Target    string    `json:"target"`
	Detail    string    `json:"detail"`
	CreatedAt time.Time `json:"created_at"`
}

// AdminAuditLog exposes the record of privileged actions.
func AdminAuditLog(c *gin.Context) {
	limit := 100
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 && v <= 500 {
		limit = v
	}
	action := c.Query("action")

	rows, err := db.DB.Query(
		`SELECT id, actor_id, action, target, detail, created_at
		 FROM admin_audit_log
		 WHERE ($1 = '' OR action ILIKE '%' || $1 || '%')
		 ORDER BY created_at DESC
		 LIMIT $2`,
		action, limit,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load the audit log"})
		return
	}
	defer rows.Close()

	out := []auditEntry{}
	for rows.Next() {
		var e auditEntry
		var actor sql.NullString
		if err := rows.Scan(&e.ID, &actor, &e.Action, &e.Target, &e.Detail, &e.CreatedAt); err != nil {
			continue
		}
		e.Actor = nullStr(actor)
		out = append(out, e)
	}

	c.JSON(http.StatusOK, gin.H{"entries": out})
}

// AdminListPublicFiles is the moderator view of the shared library: every
// entry, private ones included, with the owner attached.
func AdminListPublicFiles(c *gin.Context) {
	search := "%" + c.Query("search") + "%"

	limit := 100
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 && v <= 500 {
		limit = v
	}

	visibility := c.Query("visibility") // "", "public" or "private"

	rows, err := db.DB.Query(
		`SELECT id, owner_id, title, description, filename, mime_type,
		        size_bytes, visibility, download_count, created_at
		 FROM public_files
		 WHERE ($1 = '' OR visibility = $1)
		   AND (title ILIKE $2 OR filename ILIKE $2 OR COALESCE(owner_id,'') ILIKE $2)
		 ORDER BY created_at DESC
		 LIMIT $3`,
		visibility, search, limit,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list files"})
		return
	}
	defer rows.Close()

	out := []publicFile{}
	for rows.Next() {
		var f publicFile
		var owner sql.NullString
		if err := rows.Scan(
			&f.ID, &owner, &f.Title, &f.Description, &f.Filename, &f.MimeType,
			&f.SizeBytes, &f.Visibility, &f.DownloadCount, &f.CreatedAt,
		); err != nil {
			continue
		}
		f.Owner = nullStr(owner)
		f.CanOpen = true // an admin can open anything
		out = append(out, f)
	}

	var totalPublic, totalPrivate int
	_ = db.DB.QueryRow(`SELECT COUNT(*) FROM public_files WHERE visibility = 'public'`).Scan(&totalPublic)
	_ = db.DB.QueryRow(`SELECT COUNT(*) FROM public_files WHERE visibility = 'private'`).Scan(&totalPrivate)

	c.JSON(http.StatusOK, gin.H{
		"files": out, "public_count": totalPublic, "private_count": totalPrivate,
	})
}
