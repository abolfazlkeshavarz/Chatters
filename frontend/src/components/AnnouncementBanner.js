import { useCallback, useEffect, useState } from "react";
import { ackAnnouncement, getAnnouncements } from "../api/announcements";
import { chatSocket } from "../services/websocket";

/**
 * Admin notices pinned above the chat list.
 *
 * Deliberately not a chat message: it carries no reply, cannot be searched
 * alongside conversations, and disappears for good once acknowledged. The OK
 * press is recorded server-side rather than in localStorage, both so it
 * follows the user across devices and so the panel can report who has actually
 * read it.
 *
 * One notice is shown at a time, highest priority first, so a stack of them
 * cannot bury the chat list.
 */
export default function AnnouncementBanner() {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getAnnouncements();
      setItems(data.announcements || []);
    } catch {
      /* a notice failing to load must never break the chat list */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A notice published while the app is open should appear straight away
  // rather than waiting for the next reload.
  useEffect(() => {
    const off = chatSocket.onMessage((msg) => {
      if (msg.type === "announcement") load();
    });
    return off;
  }, [load]);

  const current = items[0];
  if (!current) return null;

  async function dismiss() {
    setBusy(true);
    try {
      await ackAnnouncement(current.id);
      setItems((prev) => prev.slice(1));
      setExpanded(false);
    } catch {
      // Drop it locally anyway: leaving a banner the user pressed OK on stuck
      // on screen is worse than it reappearing on the next load.
      setItems((prev) => prev.slice(1));
    } finally {
      setBusy(false);
    }
  }

  const accent = current.color || "#2f6fed";
  const text = current.text_color || "#ffffff";
  const long = (current.body || "").length > 220;

  return (
    <div
      className="banner-in"
      key={current.id}
      style={{ ...styles.wrap, background: accent, color: text }}
      role="status"
      aria-live="polite"
    >
      <div style={styles.head}>
        <span style={styles.icon} aria-hidden="true">
          {current.icon || "📢"}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          {current.title && <div style={styles.title}>{current.title}</div>}
          <div
            dir="auto"
            style={{
              ...styles.body,
              ...(long && !expanded ? styles.bodyClamped : null),
            }}
          >
            {current.body}
          </div>

          {long && (
            <button
              style={{ ...styles.moreBtn, color: text }}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "بستن" : "ادامه…"}
            </button>
          )}

          <div style={styles.meta}>
            از طرف <strong>{current.author_label}</strong>
            {items.length > 1 && <span> · {items.length - 1} پیام دیگر</span>}
          </div>
        </div>
      </div>

      {current.dismissible !== false && (
        <button
          style={{ ...styles.ok, color: accent }}
          onClick={dismiss}
          disabled={busy}
        >
          {busy ? "…" : "باشه"}
        </button>
      )}
    </div>
  );
}

const styles = {
  wrap: {
    flexShrink: 0,
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
  },
  head: { display: "flex", gap: 12, alignItems: "flex-start" },
  icon: { fontSize: 24, lineHeight: 1.2, flexShrink: 0 },
  title: { fontWeight: 700, fontSize: 15, marginBottom: 3 },
  body: {
    fontSize: 14,
    lineHeight: 1.7,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    textAlign: "start",
  },
  bodyClamped: {
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  moreBtn: {
    background: "none",
    border: "none",
    padding: "2px 0",
    fontSize: 13,
    fontWeight: 700,
    textDecoration: "underline",
    cursor: "pointer",
    opacity: 0.9,
  },
  meta: { fontSize: 12, opacity: 0.85, marginTop: 6 },
  ok: {
    alignSelf: "flex-end",
    background: "#fff",
    border: "none",
    borderRadius: 20,
    padding: "7px 26px",
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
    minWidth: 90,
  },
};
