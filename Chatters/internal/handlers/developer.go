package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"messenger/internal/db"

	"github.com/gin-gonic/gin"
)

// The "Developer & news" page: who makes the app, how to reach them, and
// short news posts. Read by every signed-in user, written by admins from the
// web panel.

// DeveloperContact is one way to reach the developer. Kind drives the icon
// and link the apps build: email, phone, website, telegram, instagram,
// github, linkedin, x, whatsapp, other.
type DeveloperContact struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
	Value string `json:"value"`
}

type developerProfile struct {
	Name      string             `json:"name"`
	Headline  string             `json:"headline"`
	Bio       string             `json:"bio"`
	Contacts  []DeveloperContact `json:"contacts"`
	UpdatedAt time.Time          `json:"updated_at"`
}

type developerPost struct {
	ID        int       `json:"id"`
	Title     string    `json:"title"`
	Body      string    `json:"body"`
	Emoji     string    `json:"emoji"`
	Pinned    bool      `json:"pinned"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

var contactKinds = map[string]bool{
	"email": true, "phone": true, "website": true, "telegram": true, "instagram": true,
	"github": true, "linkedin": true, "x": true, "whatsapp": true, "other": true,
}

func loadDeveloperProfile() (developerProfile, error) {
	var p developerProfile
	var contacts []byte
	err := db.DB.QueryRow(
		`SELECT name, headline, bio, contacts, updated_at FROM developer_profile WHERE id = 1`,
	).Scan(&p.Name, &p.Headline, &p.Bio, &contacts, &p.UpdatedAt)
	if err != nil {
		return p, err
	}
	_ = json.Unmarshal(contacts, &p.Contacts)
	if p.Contacts == nil {
		p.Contacts = []DeveloperContact{}
	}
	return p, nil
}

func loadDeveloperPosts(limit int) ([]developerPost, error) {
	rows, err := db.DB.Query(
		`SELECT id, title, body, emoji, pinned, created_at, updated_at
		 FROM developer_posts
		 ORDER BY pinned DESC, created_at DESC
		 LIMIT $1`, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []developerPost{}
	for rows.Next() {
		var p developerPost
		if err := rows.Scan(&p.ID, &p.Title, &p.Body, &p.Emoji, &p.Pinned, &p.CreatedAt, &p.UpdatedAt); err == nil {
			out = append(out, p)
		}
	}
	return out, nil
}

// GetDeveloperInfo serves the page to the apps. latest_at lets a client
// badge the page when something changed since it was last opened.
func GetDeveloperInfo(c *gin.Context) {
	profile, err := loadDeveloperProfile()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load developer info"})
		return
	}
	posts, err := loadDeveloperPosts(50)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load news"})
		return
	}

	latest := profile.UpdatedAt
	for _, p := range posts {
		if p.UpdatedAt.After(latest) {
			latest = p.UpdatedAt
		}
	}

	c.JSON(http.StatusOK, gin.H{"profile": profile, "posts": posts, "latest_at": latest})
}

/* ------------------------------------------------------------------ admin */

func AdminGetDeveloperInfo(c *gin.Context) {
	profile, err := loadDeveloperProfile()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load developer info"})
		return
	}
	posts, err := loadDeveloperPosts(500)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load news"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"profile": profile, "posts": posts})
}

func tooLong(s string, max int) bool { return utf8.RuneCountInString(s) > max }

func AdminUpdateDeveloperProfile(c *gin.Context) {
	var req struct {
		Name     string             `json:"name"`
		Headline string             `json:"headline"`
		Bio      string             `json:"bio"`
		Contacts []DeveloperContact `json:"contacts"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	req.Name, req.Headline = strings.TrimSpace(req.Name), strings.TrimSpace(req.Headline)
	if tooLong(req.Name, 80) || tooLong(req.Headline, 160) || tooLong(req.Bio, 4000) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a field is too long"})
		return
	}
	if len(req.Contacts) > 20 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "at most 20 contacts"})
		return
	}
	contacts := []DeveloperContact{}
	for _, ct := range req.Contacts {
		ct.Kind = strings.ToLower(strings.TrimSpace(ct.Kind))
		ct.Value = strings.TrimSpace(ct.Value)
		ct.Label = strings.TrimSpace(ct.Label)
		if ct.Value == "" {
			continue
		}
		if !contactKinds[ct.Kind] {
			ct.Kind = "other"
		}
		if tooLong(ct.Value, 300) || tooLong(ct.Label, 60) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "a contact is too long"})
			return
		}
		contacts = append(contacts, ct)
	}
	data, _ := json.Marshal(contacts)

	if _, err := db.DB.Exec(
		`UPDATE developer_profile
		 SET name = $1, headline = $2, bio = $3, contacts = $4, updated_at = now()
		 WHERE id = 1`,
		req.Name, req.Headline, req.Bio, data,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save"})
		return
	}
	auditLog(c.GetString("user_id"), "developer.profile", "", "")
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

type postRequest struct {
	Title  string `json:"title"`
	Body   string `json:"body"`
	Emoji  string `json:"emoji"`
	Pinned bool   `json:"pinned"`
}

func bindPost(c *gin.Context) (postRequest, bool) {
	var req postRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return req, false
	}
	req.Title, req.Body, req.Emoji = strings.TrimSpace(req.Title), strings.TrimSpace(req.Body), strings.TrimSpace(req.Emoji)
	if req.Title == "" && req.Body == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a post needs a title or text"})
		return req, false
	}
	if tooLong(req.Title, 160) || tooLong(req.Body, 8000) || tooLong(req.Emoji, 8) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a field is too long"})
		return req, false
	}
	return req, true
}

func AdminCreateDeveloperPost(c *gin.Context) {
	req, ok := bindPost(c)
	if !ok {
		return
	}
	var id int
	if err := db.DB.QueryRow(
		`INSERT INTO developer_posts (title, body, emoji, pinned) VALUES ($1, $2, $3, $4) RETURNING id`,
		req.Title, req.Body, req.Emoji, req.Pinned,
	).Scan(&id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to publish"})
		return
	}
	auditLog(c.GetString("user_id"), "developer.post.create", strconv.Itoa(id), req.Title)
	c.JSON(http.StatusOK, gin.H{"status": "ok", "id": id})
}

func AdminUpdateDeveloperPost(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	req, ok := bindPost(c)
	if !ok {
		return
	}
	res, err := db.DB.Exec(
		`UPDATE developer_posts SET title = $1, body = $2, emoji = $3, pinned = $4, updated_at = now() WHERE id = $5`,
		req.Title, req.Body, req.Emoji, req.Pinned, id,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "post not found"})
		return
	}
	auditLog(c.GetString("user_id"), "developer.post.update", strconv.Itoa(id), req.Title)
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func AdminDeleteDeveloperPost(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	res, err := db.DB.Exec(`DELETE FROM developer_posts WHERE id = $1`, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete"})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "post not found"})
		return
	}
	auditLog(c.GetString("user_id"), "developer.post.delete", strconv.Itoa(id), "")
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
