package handlers

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"messenger/internal/config"
	"messenger/internal/db"
	"messenger/internal/validate"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

type publicFile struct {
	ID            int       `json:"id"`
	Owner         *string   `json:"owner,omitempty"`
	Title         string    `json:"title"`
	Description   string    `json:"description"`
	Filename      string    `json:"filename"`
	MimeType      string    `json:"mime_type"`
	SizeBytes     int64     `json:"size_bytes"`
	Visibility    string    `json:"visibility"`
	DownloadCount int       `json:"download_count"`
	CreatedAt     time.Time `json:"created_at"`

	// True when the viewer may open it without supplying a password: it is
	// public, or they own it, or they are an administrator.
	CanOpen bool `json:"can_open"`
	IsOwner bool `json:"is_owner"`
}

func publicFilesDir() string {
	return filepath.Join(config.C.UploadDir, "public")
}

// uploadLimitFor returns the byte ceiling for this caller. Administrators are
// uncapped: the limit exists to stop ordinary users filling the disk, and an
// operator uploading their own material is the one person who is allowed to
// make that call. Returned as 0 meaning "no limit".
func uploadLimitFor(c *gin.Context) int64 {
	if isAdminCtx(c) {
		return 0
	}
	return config.C.MaxUploadBytes
}

// isAdminCtx reads the flag the auth middleware put on the request.
func isAdminCtx(c *gin.Context) bool {
	v, ok := c.Get("is_admin")
	return ok && v == true
}

// UploadPublicFile posts a file or media item to the shared library.
//
// A 'private' item needs a password, which is bcrypt-hashed here and never
// returned by any endpoint — the plaintext exists only in the uploader's head
// and in the request that created it.
func UploadPublicFile(c *gin.Context) {
	userID := c.GetString("user_id")

	if limit := uploadLimitFor(c); limit > 0 {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
	}

	file, err := c.FormFile("file")
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "file is too large"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "file required"})
		return
	}
	if limit := uploadLimitFor(c); limit > 0 && file.Size > limit {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "file is too large"})
		return
	}

	visibility := strings.TrimSpace(c.PostForm("visibility"))
	if visibility == "" {
		visibility = "public"
	}
	if visibility != "public" && visibility != "private" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "visibility must be 'public' or 'private'"})
		return
	}

	var passwordHash sql.NullString
	if visibility == "private" {
		password := c.PostForm("password")
		if err := validate.Password(password); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "a private item needs a password: " + err.Error()})
			return
		}
		h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "password error"})
			return
		}
		passwordHash = sql.NullString{String: string(h), Valid: true}
	}

	title := strings.TrimSpace(c.PostForm("title"))
	if len(title) > 200 {
		title = title[:200]
	}
	description := strings.TrimSpace(c.PostForm("description"))
	if len(description) > 2000 {
		description = description[:2000]
	}

	originalName := sanitizeFilename(file.Filename)
	if title == "" {
		title = originalName
	}

	dir := publicFilesDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to prepare upload directory"})
		return
	}

	storedName := fmt.Sprintf("%d_%s", time.Now().UnixNano(), originalName)
	path := filepath.Join(dir, storedName)
	if !withinUploadDir(path) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid file path"})
		return
	}

	if err := c.SaveUploadedFile(file, path); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save file"})
		return
	}

	mimeType := file.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	var id int
	err = db.DB.QueryRow(
		`INSERT INTO public_files
		   (owner_id, title, description, filename, file_path, mime_type,
		    size_bytes, visibility, password_hash)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		 RETURNING id`,
		userID, title, description, originalName, path, mimeType,
		file.Size, visibility, passwordHash,
	).Scan(&id)
	if err != nil {
		_ = os.Remove(path)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save the entry"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok", "id": id})
}

// ListPublicFiles returns the library. Private entries are listed for everyone
// — their existence, name and owner are not the secret — but the content is
// only served after the password check in DownloadPublicFile.
func ListPublicFiles(c *gin.Context) {
	userID := c.GetString("user_id")
	admin := isAdminCtx(c)

	search := "%" + strings.TrimSpace(c.Query("search")) + "%"

	limit := 60
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 && v <= 200 {
		limit = v
	}
	offset := 0
	if v, err := strconv.Atoi(c.Query("offset")); err == nil && v > 0 {
		offset = v
	}

	// "mine" narrows to the caller's own uploads for the "My files" filter.
	onlyMine := c.Query("mine") == "1"

	rows, err := db.DB.Query(
		`SELECT id, owner_id, title, description, filename, mime_type,
		        size_bytes, visibility, download_count, created_at
		 FROM public_files
		 WHERE (NOT $4 OR owner_id = $1)
		   AND (title ILIKE $2 OR filename ILIKE $2 OR description ILIKE $2
		        OR COALESCE(owner_id,'') ILIKE $2)
		 ORDER BY created_at DESC
		 LIMIT $3 OFFSET $5`,
		userID, search, limit, onlyMine, offset,
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
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read files"})
			return
		}
		f.Owner = nullStr(owner)
		f.IsOwner = owner.Valid && owner.String == userID
		f.CanOpen = f.Visibility == "public" || f.IsOwner || admin
		out = append(out, f)
	}

	var total int
	_ = db.DB.QueryRow(`SELECT COUNT(*) FROM public_files`).Scan(&total)

	c.JSON(http.StatusOK, gin.H{"files": out, "total": total})
}

// DownloadPublicFile streams an item, enforcing the private-item password.
//
// The password arrives as a query parameter because <img>/<video> cannot set
// headers; it is checked against the bcrypt hash and never logged. Admins and
// the owner skip the check entirely.
func DownloadPublicFile(c *gin.Context) {
	userID := c.GetString("user_id")
	admin := isAdminCtx(c)

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var (
		owner, hash          sql.NullString
		path, mime, filename string
		visibility           string
	)
	err = db.DB.QueryRow(
		`SELECT owner_id, file_path, mime_type, filename, visibility, password_hash
		 FROM public_files WHERE id = $1`, id,
	).Scan(&owner, &path, &mime, &filename, &visibility, &hash)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	privileged := admin || (owner.Valid && owner.String == userID)
	if visibility == "private" && !privileged {
		password := c.Query("password")
		if password == "" {
			password = c.GetHeader("X-File-Password")
		}
		if !hash.Valid || bcrypt.CompareHashAndPassword([]byte(hash.String), []byte(password)) != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "incorrect password"})
			return
		}
	}

	if !withinUploadDir(path) {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	if _, err := os.Stat(path); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	// Counting a view rather than blocking on it; a failed increment is not
	// worth failing the download over.
	go func() {
		_, _ = db.DB.Exec(`UPDATE public_files SET download_count = download_count + 1 WHERE id = $1`, id)
	}()

	c.Header("Content-Type", mime)
	c.Header("X-Content-Type-Options", "nosniff")
	c.FileAttachment(path, filename)
}

// CheckPublicFilePassword lets the browser validate a password once and then
// render the item, instead of guessing inside an <img> tag that can only
// report "broken".
func CheckPublicFilePassword(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var req struct {
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	var hash sql.NullString
	if err := db.DB.QueryRow(`SELECT password_hash FROM public_files WHERE id = $1`, id).Scan(&hash); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	if !hash.Valid || bcrypt.CompareHashAndPassword([]byte(hash.String), []byte(req.Password)) != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "incorrect password"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// DeletePublicFile removes an entry. The owner may delete their own; an
// administrator may delete anything.
func DeletePublicFile(c *gin.Context) {
	userID := c.GetString("user_id")
	admin := isAdminCtx(c)

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var owner sql.NullString
	var path string
	if err := db.DB.QueryRow(
		`SELECT owner_id, file_path FROM public_files WHERE id = $1`, id,
	).Scan(&owner, &path); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}

	if !admin && !(owner.Valid && owner.String == userID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "that is not yours to delete"})
		return
	}

	if _, err := db.DB.Exec(`DELETE FROM public_files WHERE id = $1`, id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete"})
		return
	}
	if withinUploadDir(path) {
		_ = os.Remove(path)
	}

	if admin && !(owner.Valid && owner.String == userID) {
		auditLog(userID, "public_file.delete", strconv.Itoa(id), path)
	}

	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

// UpdatePublicFile lets the owner (or an admin) retitle an item or change its
// visibility. Switching to private requires a password in the same request,
// which the CHECK constraint on the table also enforces.
func UpdatePublicFile(c *gin.Context) {
	userID := c.GetString("user_id")
	admin := isAdminCtx(c)

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var req struct {
		Title       *string `json:"title"`
		Description *string `json:"description"`
		Visibility  *string `json:"visibility"`
		Password    *string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	var owner sql.NullString
	var visibility string
	if err := db.DB.QueryRow(
		`SELECT owner_id, visibility FROM public_files WHERE id = $1`, id,
	).Scan(&owner, &visibility); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	if !admin && !(owner.Valid && owner.String == userID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "that is not yours to edit"})
		return
	}

	newVisibility := visibility
	if req.Visibility != nil {
		if *req.Visibility != "public" && *req.Visibility != "private" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "visibility must be 'public' or 'private'"})
			return
		}
		newVisibility = *req.Visibility
	}

	var passwordHash sql.NullString
	setPassword := false
	if req.Password != nil && *req.Password != "" {
		if err := validate.Password(*req.Password); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		h, err := bcrypt.GenerateFromPassword([]byte(*req.Password), bcrypt.DefaultCost)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "password error"})
			return
		}
		passwordHash = sql.NullString{String: string(h), Valid: true}
		setPassword = true
	}

	// Going private with no stored password and none supplied would create a
	// row nobody but an admin could ever open.
	if newVisibility == "private" && visibility != "private" && !setPassword {
		c.JSON(http.StatusBadRequest, gin.H{"error": "set a password when making an item private"})
		return
	}

	_, err = db.DB.Exec(
		`UPDATE public_files
		 SET title       = COALESCE($1, title),
		     description = COALESCE($2, description),
		     visibility  = $3,
		     password_hash = CASE
		         WHEN $3 = 'public' THEN NULL
		         WHEN $4 THEN $5
		         ELSE password_hash
		     END
		 WHERE id = $6`,
		req.Title, req.Description, newVisibility, setPassword, passwordHash, id,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
