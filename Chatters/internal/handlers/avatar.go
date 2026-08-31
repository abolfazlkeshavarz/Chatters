package handlers

import (
	"database/sql"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"messenger/internal/config"
	"messenger/internal/db"

	"github.com/gin-gonic/gin"
)

// Avatars are capped independently of MAX_UPLOAD_BYTES (which governs chat
// attachments and can reasonably be set much larger) — a profile photo has no
// business being tens of megabytes.
const maxAvatarBytes = 5 << 20 // 5 MiB

var allowedAvatarMimes = map[string]string{
	"image/jpeg": "jpg",
	"image/png":  "png",
	"image/webp": "webp",
	"image/gif":  "gif",
}

func avatarDir() string {
	return filepath.Join(config.C.UploadDir, "avatars")
}

// UploadAvatar replaces the caller's profile photo. The previous file, if
// any, is deleted — there is exactly one avatar per user, not a history of
// them, so nothing is served from disk that the database no longer points at.
func UploadAvatar(c *gin.Context) {
	userID := c.GetString("user_id")

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxAvatarBytes)

	file, err := c.FormFile("file")
	if err != nil {
		// An oversized body never reaches the file.Size check below: the
		// MaxBytesReader trips first, mid-parse, so ParseMultipartForm itself
		// fails with *http.MaxBytesError rather than returning a file. That
		// has to be told apart from "no file field at all" or an oversized
		// upload would be reported as a malformed request instead of the 413
		// a client can actually act on.
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "image is too large (max 5 MB)"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "file required"})
		return
	}
	if file.Size > maxAvatarBytes {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "image is too large (max 5 MB)"})
		return
	}

	mimeType := file.Header.Get("Content-Type")
	ext, ok := allowedAvatarMimes[mimeType]
	if !ok {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "avatar must be a JPEG, PNG, WebP or GIF image"})
		return
	}

	dir := avatarDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to prepare upload directory"})
		return
	}

	// Sanitised by construction rather than derived from the uploaded
	// filename: userID is already constrained to safe characters by
	// validate.Username, and the extension comes from a fixed allowlist.
	storedName := userID + "_" + strconv.FormatInt(time.Now().UnixNano(), 10) + "." + ext
	path := filepath.Join(dir, storedName)

	if !withinUploadDir(path) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid file path"})
		return
	}

	if err := c.SaveUploadedFile(file, path); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save file"})
		return
	}

	var oldPath sql.NullString
	err = db.DB.QueryRow(`SELECT avatar_path FROM users WHERE id = $1`, userID).Scan(&oldPath)
	if err != nil {
		_ = os.Remove(path)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}

	if _, err := db.DB.Exec(
		`UPDATE users SET avatar_path = $1, avatar_mime = $2, avatar_updated_at = now() WHERE id = $3`,
		path, mimeType, userID,
	); err != nil {
		_ = os.Remove(path)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save avatar"})
		return
	}

	if oldPath.Valid && oldPath.String != "" && oldPath.String != path {
		_ = os.Remove(oldPath.String)
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// DeleteAvatar removes the caller's profile photo, reverting them to the
// initial-letter placeholder every client already falls back to.
func DeleteAvatar(c *gin.Context) {
	userID := c.GetString("user_id")

	var oldPath sql.NullString
	if err := db.DB.QueryRow(`SELECT avatar_path FROM users WHERE id = $1`, userID).Scan(&oldPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "db error"})
		return
	}

	if _, err := db.DB.Exec(
		`UPDATE users SET avatar_path = NULL, avatar_mime = NULL, avatar_updated_at = now() WHERE id = $1`,
		userID,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to remove avatar"})
		return
	}

	if oldPath.Valid && oldPath.String != "" {
		_ = os.Remove(oldPath.String)
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// SetAvatarVisibility chooses who besides the owner can fetch the image:
// every signed-in user, or only people on either side of a contacts
// relationship with them.
func SetAvatarVisibility(c *gin.Context) {
	userID := c.GetString("user_id")

	var req struct {
		Visibility string `json:"visibility"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	if req.Visibility != "public" && req.Visibility != "contacts" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "visibility must be 'public' or 'contacts'"})
		return
	}

	if _, err := db.DB.Exec(`UPDATE users SET avatar_visibility = $1 WHERE id = $2`, req.Visibility, userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update visibility"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok", "visibility": req.Visibility})
}

// GetAvatar serves a user's profile photo, enforcing their visibility choice.
// "Not found" covers three distinct cases (no such user, no avatar set, not
// permitted to view it) on purpose: distinguishing them would let a caller
// probe which usernames exist or have photos.
func GetAvatar(c *gin.Context) {
	viewer := c.GetString("user_id")
	target := c.Param("id")

	var path, mimeType, visibility sql.NullString
	err := db.DB.QueryRow(
		`SELECT avatar_path, avatar_mime, avatar_visibility FROM users WHERE id = $1`,
		target,
	).Scan(&path, &mimeType, &visibility)
	if err != nil || !path.Valid || path.String == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "no avatar"})
		return
	}

	if target != viewer && visibility.String == "contacts" && !contactsEitherWay(target, viewer) {
		c.JSON(http.StatusNotFound, gin.H{"error": "no avatar"})
		return
	}

	if !withinUploadDir(path.String) {
		c.JSON(http.StatusNotFound, gin.H{"error": "no avatar"})
		return
	}
	if _, err := os.Stat(path.String); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no avatar"})
		return
	}

	// No caching: the URL is the same before and after a re-upload (it is
	// just the user's id), so anything beyond "don't serve this again without
	// asking" risks showing a stale photo after someone changes it. The
	// frontend already fetches images as blobs rather than via <img src>, so
	// this costs one small request per view, not per message.
	c.Header("Cache-Control", "private, no-store")
	c.Header("Content-Type", mimeType.String)
	c.File(path.String)
}

func contactsEitherWay(a, b string) bool {
	var ok bool
	_ = db.DB.QueryRow(
		`SELECT EXISTS (
			SELECT 1 FROM contacts
			WHERE (owner_id = $1 AND contact_id = $2) OR (owner_id = $2 AND contact_id = $1)
		)`,
		a, b,
	).Scan(&ok)
	return ok
}
