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

type adminUserMessage struct {
	ID          int        `json:"id"`
	ChatID      string     `json:"chat_id"`
	ChatName    *string    `json:"chat_name,omitempty"`
	IsGroup     bool       `json:"is_group"`
	IsSecret    bool       `json:"is_secret"`
	Members     []string   `json:"members"`
	Content     string     `json:"content"`
	Type        string     `json:"type"`
	IsEncrypted bool       `json:"is_encrypted"`
	HasFile     bool       `json:"has_file"`
	Filename    *string    `json:"filename,omitempty"`
	MimeType    *string    `json:"mime_type,omitempty"`
	Status      string     `json:"status"`
	CreatedAt   time.Time  `json:"created_at"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
}

// AdminGetUserMessages returns what one account has actually sent, with the
// conversation each message belongs to attached.
//
// This is the drill-down behind the counters on the user detail view: a number
// on its own ("412 messages") tells a moderator nothing they can act on. Pass
// media=1 to narrow it to attachments.
//
// Encrypted bodies come back as stored ciphertext and are flagged; the server
// holds no key for them and this endpoint does not change that.
func AdminGetUserMessages(c *gin.Context) {
	target := c.Param("id")
	mediaOnly := c.Query("media") == "1"

	limit := 100
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 && v <= 500 {
		limit = v
	}
	offset := 0
	if v, err := strconv.Atoi(c.Query("offset")); err == nil && v > 0 {
		offset = v
	}

	rows, err := db.DB.Query(
		`SELECT m.id, m.chat_id::text, ch.name, ch.is_group, ch.is_secret,
		        COALESCE(m.content, ''), m.type, m.is_encrypted,
		        m.file_path IS NOT NULL, m.filename, m.mime_type,
		        m.status, m.created_at, m.expires_at,
		        COALESCE((SELECT ARRAY_AGG(cm.user_id) FROM chat_members cm
		                   WHERE cm.chat_id = ch.id), '{}')
		 FROM messages m
		 JOIN chats ch ON ch.id = m.chat_id
		 WHERE m.sender_id = $1
		   AND (NOT $2 OR m.file_path IS NOT NULL)
		 ORDER BY m.id DESC
		 LIMIT $3 OFFSET $4`,
		target, mediaOnly, limit, offset,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load messages"})
		return
	}
	defer rows.Close()

	out := []adminUserMessage{}
	for rows.Next() {
		var m adminUserMessage
		var chatName, filename, mimeType sql.NullString
		var expiresAt sql.NullTime
		if err := rows.Scan(
			&m.ID, &m.ChatID, &chatName, &m.IsGroup, &m.IsSecret,
			&m.Content, &m.Type, &m.IsEncrypted,
			&m.HasFile, &filename, &mimeType,
			&m.Status, &m.CreatedAt, &expiresAt, pq.Array(&m.Members),
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read messages"})
			return
		}
		m.ChatName = nullStr(chatName)
		m.Filename = nullStr(filename)
		m.MimeType = nullStr(mimeType)
		if expiresAt.Valid {
			m.ExpiresAt = &expiresAt.Time
		}
		out = append(out, m)
	}

	var total int
	_ = db.DB.QueryRow(
		`SELECT COUNT(*) FROM messages
		 WHERE sender_id = $1 AND (NOT $2 OR file_path IS NOT NULL)`,
		target, mediaOnly,
	).Scan(&total)

	c.JSON(http.StatusOK, gin.H{"messages": out, "total": total})
}

// AdminGetUserChats lists every conversation an account belongs to, with the
// other members and its last activity — the drill-down behind the chat counts.
func AdminGetUserChats(c *gin.Context) {
	target := c.Param("id")

	rows, err := db.DB.Query(
		`SELECT c.id::text, c.is_group, c.is_secret, c.e2e_enabled,
		        c.self_destruct_seconds, c.name, c.created_at,
		        COALESCE(ARRAY_AGG(DISTINCT cm2.user_id), '{}') AS members,
		        (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS message_count,
		        (SELECT COUNT(*) FROM messages m
		          WHERE m.chat_id = c.id AND m.sender_id = $1) AS from_user,
		        (SELECT MAX(m.created_at) FROM messages m WHERE m.chat_id = c.id) AS last_activity
		 FROM chats c
		 JOIN chat_members cm ON cm.chat_id = c.id AND cm.user_id = $1
		 LEFT JOIN chat_members cm2 ON cm2.chat_id = c.id
		 GROUP BY c.id
		 ORDER BY last_activity DESC NULLS LAST, c.created_at DESC`,
		target,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load chats"})
		return
	}
	defer rows.Close()

	type userChat struct {
		ID                  string     `json:"id"`
		IsGroup             bool       `json:"is_group"`
		IsSecret            bool       `json:"is_secret"`
		E2EEnabled          bool       `json:"e2e_enabled"`
		SelfDestructSeconds int        `json:"self_destruct_seconds"`
		Name                *string    `json:"name,omitempty"`
		Members             []string   `json:"members"`
		MessageCount        int        `json:"message_count"`
		FromUser            int        `json:"from_user"`
		CreatedAt           time.Time  `json:"created_at"`
		LastActivity        *time.Time `json:"last_activity,omitempty"`
	}

	out := []userChat{}
	for rows.Next() {
		var ch userChat
		var name sql.NullString
		var last sql.NullTime
		if err := rows.Scan(
			&ch.ID, &ch.IsGroup, &ch.IsSecret, &ch.E2EEnabled,
			&ch.SelfDestructSeconds, &name, &ch.CreatedAt,
			pq.Array(&ch.Members), &ch.MessageCount, &ch.FromUser, &last,
		); err != nil {
			continue
		}
		ch.Name = nullStr(name)
		if last.Valid {
			ch.LastActivity = &last.Time
		}
		out = append(out, ch)
	}

	c.JSON(http.StatusOK, gin.H{"chats": out})
}

// AdminGetUserFiles lists the account's uploads to the shared library.
func AdminGetUserFiles(c *gin.Context) {
	target := c.Param("id")

	rows, err := db.DB.Query(
		`SELECT id, owner_id, title, description, filename, mime_type,
		        size_bytes, visibility, download_count, created_at
		 FROM public_files
		 WHERE owner_id = $1
		 ORDER BY created_at DESC`,
		target,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load files"})
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
		f.CanOpen = true
		out = append(out, f)
	}

	c.JSON(http.StatusOK, gin.H{"files": out})
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
