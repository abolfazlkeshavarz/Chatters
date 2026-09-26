import { useCallback, useEffect, useState } from "react";
import {
  createDeveloperPost,
  deleteDeveloperPost,
  getDeveloperInfo,
  saveDeveloperProfile,
  updateDeveloperPost,
} from "../api/admin";

// The "Developer & news" page of the Android / iOS apps: who makes Chatters,
// how to reach them, and short news posts. Everything here is shown to every
// signed-in app user under Settings → About.

const KINDS = [
  { id: "email", label: "Email", placeholder: "you@example.com" },
  { id: "phone", label: "Phone", placeholder: "+98 912 000 0000" },
  { id: "website", label: "Website", placeholder: "https://example.com" },
  { id: "telegram", label: "Telegram", placeholder: "username" },
  { id: "instagram", label: "Instagram", placeholder: "username" },
  { id: "github", label: "GitHub", placeholder: "username" },
  { id: "linkedin", label: "LinkedIn", placeholder: "profile URL or username" },
  { id: "x", label: "X / Twitter", placeholder: "username" },
  { id: "whatsapp", label: "WhatsApp", placeholder: "+98 912 000 0000" },
  { id: "other", label: "Other", placeholder: "text or link" },
];

const EMOJIS = ["📢", "🎉", "🚀", "✨", "🛠️", "🐞", "🔒", "💜", "📱", "ℹ️"];

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

const EMPTY_POST = { title: "", body: "", emoji: "📢", pinned: false };

export default function AdminDeveloper({ onNotice, onError }) {
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(EMPTY_POST);
  const [editing, setEditing] = useState(null); // post id or null

  const load = useCallback(async () => {
    try {
      const data = await getDeveloperInfo();
      setProfile({
        name: data.profile.name || "",
        headline: data.profile.headline || "",
        bio: data.profile.bio || "",
        contacts: data.profile.contacts || [],
      });
      setPosts(data.posts || []);
    } catch (err) {
      onError(err.message);
    }
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveProfile() {
    setSaving(true);
    try {
      await saveDeveloperProfile(profile);
      onNotice("Developer profile saved — the apps show it right away");
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function setContact(i, patch) {
    setProfile((p) => ({
      ...p,
      contacts: p.contacts.map((c, j) => (j === i ? { ...c, ...patch } : c)),
    }));
  }

  function moveContact(i, delta) {
    setProfile((p) => {
      const list = [...p.contacts];
      const j = i + delta;
      if (j < 0 || j >= list.length) return p;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...p, contacts: list };
    });
  }

  async function submitPost(e) {
    e.preventDefault();
    try {
      if (editing) {
        await updateDeveloperPost(editing, draft);
        onNotice("Post updated");
      } else {
        await createDeveloperPost(draft);
        onNotice("Post published");
      }
      setDraft(EMPTY_POST);
      setEditing(null);
      load();
    } catch (err) {
      onError(err.message);
    }
  }

  async function removePost(post) {
    if (!window.confirm(`Delete "${post.title || "this post"}"?`)) return;
    try {
      await deleteDeveloperPost(post.id);
      onNotice("Post deleted");
      load();
    } catch (err) {
      onError(err.message);
    }
  }

  async function togglePin(post) {
    try {
      await updateDeveloperPost(post.id, { ...post, pinned: !post.pinned });
      load();
    } catch (err) {
      onError(err.message);
    }
  }

  if (!profile) return <div className="muted">Loading…</div>;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
        This is the <strong>Developer &amp; news</strong> page in the Android and iOS
        apps (Settings → About). Users see a dot on it when you publish or change
        something.
      </div>

      {/* ---------------------------------------------------------- profile */}
      <div className="card stack" style={{ gap: 12 }}>
        <h3 style={{ margin: 0 }}>Profile</h3>
        <div className="form-grid">
          <label className="form-cell">
            <div className="muted" style={styles.label}>Name</div>
            <input
              className="field"
              value={profile.name}
              maxLength={80}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              placeholder="Your name"
            />
          </label>
          <label className="form-cell">
            <div className="muted" style={styles.label}>Headline</div>
            <input
              className="field"
              value={profile.headline}
              maxLength={160}
              onChange={(e) => setProfile({ ...profile, headline: e.target.value })}
              placeholder="Developer of Chatters"
            />
          </label>
        </div>
        <label>
          <div className="muted" style={styles.label}>About (shown under your name)</div>
          <textarea
            className="field"
            dir="auto"
            rows={4}
            maxLength={4000}
            value={profile.bio}
            onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
            placeholder="A few words about you and the app…"
          />
        </label>

        <div className="muted" style={styles.label}>Contact info</div>
        {profile.contacts.length === 0 && (
          <div className="muted" style={{ fontSize: 13 }}>No contacts yet.</div>
        )}
        {profile.contacts.map((c, i) => {
          const kind = KINDS.find((k) => k.id === c.kind) || KINDS[KINDS.length - 1];
          return (
            <div key={i} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <select
                className="field"
                style={{ width: 150 }}
                value={c.kind}
                onChange={(e) => setContact(i, { kind: e.target.value })}
              >
                {KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
              <input
                className="field"
                style={{ flex: 2, minWidth: 180 }}
                value={c.value}
                maxLength={300}
                placeholder={kind.placeholder}
                onChange={(e) => setContact(i, { value: e.target.value })}
              />
              <input
                className="field"
                style={{ flex: 1, minWidth: 120 }}
                value={c.label}
                maxLength={60}
                placeholder="Label (optional)"
                onChange={(e) => setContact(i, { label: e.target.value })}
              />
              <button className="btn btn-secondary" title="Move up" onClick={() => moveContact(i, -1)}>
                ↑
              </button>
              <button className="btn btn-secondary" title="Move down" onClick={() => moveContact(i, 1)}>
                ↓
              </button>
              <button
                className="btn btn-danger"
                onClick={() =>
                  setProfile((p) => ({ ...p, contacts: p.contacts.filter((_, j) => j !== i) }))
                }
              >
                ✕
              </button>
            </div>
          );
        })}
        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={() =>
              setProfile((p) => ({
                ...p,
                contacts: [...p.contacts, { kind: "email", value: "", label: "" }],
              }))
            }
          >
            + Add contact
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn" disabled={saving} onClick={saveProfile}>
            {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------ posts */}
      <form className="card stack" style={{ gap: 12 }} onSubmit={submitPost}>
        <h3 style={{ margin: 0 }}>{editing ? "Edit post" : "New post"}</h3>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {EMOJIS.map((e) => (
            <button
              type="button"
              key={e}
              className={`btn ${draft.emoji === e ? "" : "btn-secondary"}`}
              style={{ fontSize: 18, padding: "6px 10px" }}
              onClick={() => setDraft({ ...draft, emoji: e })}
            >
              {e}
            </button>
          ))}
        </div>
        <input
          className="field"
          dir="auto"
          value={draft.title}
          maxLength={160}
          placeholder="Title"
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
        <textarea
          className="field"
          dir="auto"
          rows={5}
          maxLength={8000}
          value={draft.body}
          placeholder="What's new?"
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
        />
        <label className="row" style={{ gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={draft.pinned}
            onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })}
          />
          <span>Pin to the top</span>
        </label>
        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          {editing && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setEditing(null);
                setDraft(EMPTY_POST);
              }}
            >
              Cancel
            </button>
          )}
          <button className="btn" type="submit" disabled={!draft.title.trim() && !draft.body.trim()}>
            {editing ? "Save changes" : "Publish"}
          </button>
        </div>
      </form>

      <div className="stack" style={{ gap: 10 }}>
        {posts.length === 0 && <div className="muted">No posts yet.</div>}
        {posts.map((post) => (
          <div key={post.id} className="card" style={{ display: "flex", gap: 12 }}>
            <div style={{ fontSize: 26 }}>{post.emoji || "📢"}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700 }} dir="auto">
                {post.pinned && "📌 "}
                {post.title}
              </div>
              <div dir="auto" style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>
                {post.body}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {formatDate(post.created_at)}
                {post.updated_at !== post.created_at && ` · edited ${formatDate(post.updated_at)}`}
              </div>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setEditing(post.id);
                  setDraft({ title: post.title, body: post.body, emoji: post.emoji, pinned: post.pinned });
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                Edit
              </button>
              <button className="btn btn-secondary" onClick={() => togglePin(post)}>
                {post.pinned ? "Unpin" : "Pin"}
              </button>
              <button className="btn btn-danger" onClick={() => removePost(post)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  label: { fontSize: 12, marginBottom: 4 },
};
