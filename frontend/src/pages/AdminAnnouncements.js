import { useCallback, useEffect, useState } from "react";
import {
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncementReaders,
  listAnnouncements,
  listUsers,
  setAnnouncementActive,
} from "../api/admin";

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

// Presets, because picking two colours that stay readable together is exactly
// the kind of thing that goes wrong when it is left to a raw colour picker —
// each pair here has been chosen for contrast, and the custom fields are still
// there for anyone who wants them.
const THEMES = [
  { name: "Blue", color: "#2f6fed", text: "#ffffff" },
  { name: "Green", color: "#15803d", text: "#ffffff" },
  { name: "Amber", color: "#b45309", text: "#ffffff" },
  { name: "Red", color: "#b91c1c", text: "#ffffff" },
  { name: "Purple", color: "#6d28d9", text: "#ffffff" },
  { name: "Slate", color: "#334155", text: "#ffffff" },
  { name: "Light", color: "#f1f5f9", text: "#0f172a" },
];

const ICONS = ["📢", "📌", "⚠️", "🎉", "🔔", "ℹ️", "🛠️", "🔒", "❤️", "⏰"];

const PRIORITIES = [
  { id: "low", label: "Low" },
  { id: "normal", label: "Normal" },
  { id: "high", label: "High" },
  { id: "critical", label: "Critical" },
];

/** Exactly what the user will see, rendered from the same fields. */
function Preview({ draft }) {
  return (
    <div style={{ ...previewStyles.wrap, background: draft.color, color: draft.text_color }}>
      <div style={previewStyles.head}>
        <span style={{ fontSize: 24 }}>{draft.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {draft.title && <div style={previewStyles.title}>{draft.title}</div>}
          <div dir="auto" style={previewStyles.body}>
            {draft.body || "متن پیام شما اینجا نمایش داده می‌شود…"}
          </div>
          <div style={previewStyles.meta}>
            از طرف <strong>{draft.author_label || "—"}</strong>
          </div>
        </div>
      </div>
      {draft.dismissible && (
        <button style={{ ...previewStyles.ok, color: draft.color }} disabled>
          باشه
        </button>
      )}
    </div>
  );
}

function Composer({ onSent, onError }) {
  const [draft, setDraft] = useState({
    author_label: "",
    title: "",
    body: "",
    color: THEMES[0].color,
    text_color: THEMES[0].text,
    icon: "📢",
    priority: "normal",
    dismissible: true,
    everyone: true,
    expires_at: "",
  });
  const [targets, setTargets] = useState([]);
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState([]);
  const [sending, setSending] = useState(false);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  // Only searched when actually addressing specific people.
  useEffect(() => {
    if (draft.everyone || userQuery.trim().length < 1) {
      setUserResults([]);
      return undefined;
    }
    const t = setTimeout(() => {
      listUsers({ search: userQuery.trim(), limit: 8 })
        .then((d) => setUserResults(d.users || []))
        .catch(() => setUserResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [userQuery, draft.everyone]);

  async function send() {
    if (!draft.body.trim()) {
      onError("Write the message body first");
      return;
    }
    if (!draft.author_label.trim()) {
      onError("Enter the name users should see this signed with");
      return;
    }
    if (!draft.everyone && targets.length === 0) {
      onError("Pick at least one recipient, or send to everyone");
      return;
    }

    setSending(true);
    try {
      await createAnnouncement({
        ...draft,
        // datetime-local gives a local wall-clock string; the API wants RFC3339.
        expires_at: draft.expires_at ? new Date(draft.expires_at).toISOString() : null,
        targets,
      });
      setDraft((d) => ({ ...d, title: "", body: "", expires_at: "" }));
      setTargets([]);
      onSent();
    } catch (err) {
      onError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card stack" style={{ gap: 14 }}>
      <strong>New announcement</strong>
      <div className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
        Pinned above the recipient's chat list until they press OK. It is not a
        chat message: nobody can reply to it, and it never appears in a
        conversation.
      </div>

      <label style={styles.label}>
        Signed as — the name users will see
        <input
          className="field"
          placeholder="e.g. Support team, or your own name"
          value={draft.author_label}
          onChange={(e) => set({ author_label: e.target.value })}
        />
      </label>

      <label style={styles.label}>
        Title (optional)
        <input
          className="field"
          value={draft.title}
          onChange={(e) => set({ title: e.target.value })}
        />
      </label>

      <label style={styles.label}>
        Message
        <textarea
          className="field"
          rows={5}
          style={{ resize: "vertical", fontFamily: "inherit" }}
          placeholder="Write in the language your users read — the app UI is Persian."
          value={draft.body}
          onChange={(e) => set({ body: e.target.value })}
        />
      </label>

      <div>
        <div style={styles.label}>Colour</div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {THEMES.map((t) => (
            <button
              key={t.name}
              title={t.name}
              onClick={() => set({ color: t.color, text_color: t.text })}
              style={{
                ...styles.swatch,
                background: t.color,
                outline: draft.color === t.color ? "3px solid var(--primary)" : "none",
              }}
            />
          ))}
          <label style={styles.inlineColor}>
            Custom
            <input
              type="color"
              value={draft.color}
              onChange={(e) => set({ color: e.target.value })}
            />
          </label>
          <label style={styles.inlineColor}>
            Text
            <input
              type="color"
              value={draft.text_color}
              onChange={(e) => set({ text_color: e.target.value })}
            />
          </label>
        </div>
      </div>

      <div>
        <div style={styles.label}>Icon</div>
        <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
          {ICONS.map((i) => (
            <button
              key={i}
              onClick={() => set({ icon: i })}
              style={{
                ...styles.icon,
                outline: draft.icon === i ? "2px solid var(--primary)" : "none",
              }}
            >
              {i}
            </button>
          ))}
        </div>
      </div>

      {/*
        A grid rather than a flex row: a datetime-local input has an unusually
        wide intrinsic size, and as a flex item (which defaults to
        `min-width: auto`) it refuses to shrink below it and pushes out of the
        card. Grid tracks with a minmax floor size the cells instead of letting
        the content dictate them, so the two fields sit inline and wrap
        cleanly when there is no room for both.
      */}
      <div className="form-grid">
        <label className="form-cell">
          Priority
          <select
            className="field"
            value={draft.priority}
            onChange={(e) => set({ priority: e.target.value })}
          >
            {PRIORITIES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="form-cell">
          Expires (optional)
          <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
            <input
              className="field"
              type="datetime-local"
              value={draft.expires_at}
              onChange={(e) => set({ expires_at: e.target.value })}
            />
            {draft.expires_at && (
              <button
                className="btn btn-secondary btn-icon"
                style={{ width: 38, height: 38, minHeight: 38, fontSize: 15 }}
                title="Clear the expiry"
                onClick={() => set({ expires_at: "" })}
              >
                ✕
              </button>
            )}
          </div>
          <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>
            {draft.expires_at
              ? `Hides itself on ${new Date(draft.expires_at).toLocaleString()}`
              : "Stays until you deactivate it"}
          </span>
        </label>
      </div>

      <label style={styles.check}>
        <input
          type="checkbox"
          checked={draft.dismissible}
          onChange={(e) => set({ dismissible: e.target.checked })}
        />
        Users can dismiss it with OK
      </label>
      {!draft.dismissible && (
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
          A non-dismissible notice stays on every recipient's chat list until you
          deactivate it here. Use it sparingly.
        </div>
      )}

      <div>
        <div style={styles.label}>Audience</div>
        <div className="row" style={{ gap: 6 }}>
          <button
            className={draft.everyone ? "btn" : "btn btn-secondary"}
            style={{ flex: 1 }}
            onClick={() => set({ everyone: true })}
          >
            Everyone
          </button>
          <button
            className={!draft.everyone ? "btn" : "btn btn-secondary"}
            style={{ flex: 1 }}
            onClick={() => set({ everyone: false })}
          >
            Specific users
          </button>
        </div>
      </div>

      {!draft.everyone && (
        <div className="stack" style={{ gap: 8 }}>
          <input
            className="field"
            placeholder="Search users to add…"
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
          />
          {userResults.length > 0 && (
            <div className="card" style={{ padding: 6 }}>
              {userResults.map((u) => (
                <button
                  key={u.id}
                  className="btn btn-secondary"
                  style={{ ...styles.small, width: "100%", justifyContent: "flex-start" }}
                  onClick={() => {
                    setTargets((prev) => (prev.includes(u.id) ? prev : [...prev, u.id]));
                    setUserQuery("");
                  }}
                >
                  + {u.id}
                </button>
              ))}
            </div>
          )}
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {targets.map((t) => (
              <span key={t} className="badge">
                {t}{" "}
                <button
                  style={styles.chipX}
                  onClick={() => setTargets((prev) => prev.filter((x) => x !== t))}
                >
                  ✕
                </button>
              </span>
            ))}
            {targets.length === 0 && <span className="muted">No recipients chosen yet.</span>}
          </div>
        </div>
      )}

      <div>
        <div style={styles.label}>Preview — exactly what users will see</div>
        <Preview draft={draft} />
      </div>

      <button className="btn" onClick={send} disabled={sending}>
        {sending ? "Sending…" : "📢 Publish announcement"}
      </button>
    </div>
  );
}

function ReadersModal({ id, onClose }) {
  const [readers, setReaders] = useState(null);

  useEffect(() => {
    getAnnouncementReaders(id)
      .then((d) => setReaders(d.readers || []))
      .catch(() => setReaders([]));
  }, [id]);

  const acked = (readers || []).filter((r) => r.acked);
  const waiting = (readers || []).filter((r) => !r.acked);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: 20 }} className="stack">
          <h3 style={{ margin: 0 }}>Who has seen it</h3>
          {readers === null && <div className="muted">Loading…</div>}
          {readers && (
            <>
              <div className="muted">
                {acked.length} acknowledged · {waiting.length} not yet
              </div>
              <div className="scroll-area" style={{ maxHeight: 320 }}>
                {acked.map((r) => (
                  <div key={r.user_id} style={styles.readerRow}>
                    <span>✅ {r.user_id}</span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {formatDate(r.acked_at)}
                    </span>
                  </div>
                ))}
                {waiting.map((r) => (
                  <div key={r.user_id} style={styles.readerRow}>
                    <span className="muted">⏳ {r.user_id}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminAnnouncements({ onNotice, onError }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [readersFor, setReadersFor] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAnnouncements();
      setRows(data.announcements || []);
    } catch (err) {
      onError(err.message);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(row) {
    try {
      await setAnnouncementActive(row.id, !row.active);
      onNotice(row.active ? "Deactivated" : "Reactivated");
      load();
    } catch (err) {
      onError(err.message);
    }
  }

  async function remove(row) {
    if (!window.confirm("Delete this announcement and its read receipts?")) return;
    try {
      await deleteAnnouncement(row.id);
      onNotice("Deleted");
      load();
    } catch (err) {
      onError(err.message);
    }
  }

  return (
    <div className="stack">
      {readersFor && <ReadersModal id={readersFor} onClose={() => setReadersFor(null)} />}

      <Composer
        onSent={() => {
          onNotice("Announcement published");
          load();
        }}
        onError={onError}
      />

      <strong>Published</strong>
      {loading && <div className="muted">Loading…</div>}
      {!loading && rows.length === 0 && (
        <div className="card muted" style={{ textAlign: "center" }}>
          Nothing published yet.
        </div>
      )}

      {rows.map((row) => (
        <div key={row.id} className="card stack" style={{ gap: 10 }}>
          <div
            style={{
              ...previewStyles.wrap,
              background: row.color,
              color: row.text_color,
              boxShadow: "none",
              borderRadius: 10,
            }}
          >
            <div style={previewStyles.head}>
              <span style={{ fontSize: 20 }}>{row.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                {row.title && <div style={previewStyles.title}>{row.title}</div>}
                <div dir="auto" style={previewStyles.body}>
                  {row.body}
                </div>
              </div>
            </div>
          </div>

          <div className="muted" style={{ fontSize: 13, lineHeight: 1.8 }}>
            <div>
              Signed “{row.author_label}” · by {row.created_by || "—"} ·{" "}
              {formatDate(row.created_at)}
            </div>
            <div>
              {row.everyone ? "Everyone" : `${row.targets.length} recipients`} ·{" "}
              read by {row.ack_count} of {row.audience} · priority {row.priority}
              {!row.dismissible && " · not dismissible"}
              {row.expires_at && ` · expires ${formatDate(row.expires_at)}`}
            </div>
          </div>

          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="badge" style={row.active ? undefined : { opacity: 0.6 }}>
              {row.active ? "Active" : "Inactive"}
            </span>
            <button className="btn btn-secondary" style={styles.small} onClick={() => toggle(row)}>
              {row.active ? "Deactivate" : "Reactivate"}
            </button>
            <button
              className="btn btn-secondary"
              style={styles.small}
              onClick={() => setReadersFor(row.id)}
            >
              👁 Readers
            </button>
            <button className="btn btn-secondary" style={styles.small} onClick={() => remove(row)}>
              🗑 Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

const styles = {
  label: { display: "flex", flexDirection: "column", gap: 5, fontSize: 13, fontWeight: 600 },
  check: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 8,
    border: "1px solid var(--border)",
    cursor: "pointer",
  },
  inlineColor: { display: "flex", alignItems: "center", gap: 5, fontSize: 12 },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    fontSize: 17,
    background: "var(--bg)",
    border: "1px solid var(--border)",
    cursor: "pointer",
  },
  small: { fontSize: 12, padding: "5px 10px" },
  chipX: { background: "none", border: "none", cursor: "pointer", padding: 0, marginInlineStart: 4 },
  readerRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    padding: "6px 0",
    borderBottom: "1px solid var(--border)",
    fontSize: 13,
  },
};

const previewStyles = {
  wrap: {
    padding: "12px 14px",
    borderRadius: 12,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
  },
  head: { display: "flex", gap: 12, alignItems: "flex-start" },
  title: { fontWeight: 700, fontSize: 15, marginBottom: 3 },
  body: { fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word" },
  meta: { fontSize: 12, opacity: 0.85, marginTop: 6 },
  ok: {
    alignSelf: "flex-end",
    background: "#fff",
    border: "none",
    borderRadius: 20,
    padding: "7px 26px",
    fontWeight: 700,
    fontSize: 14,
    minWidth: 90,
  },
};
