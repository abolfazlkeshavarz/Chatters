import { useCallback, useEffect, useState } from "react";
import {
  fetchAdminMediaURL,
  getUserChats,
  getUserDetail,
  getUserFiles,
  getUserMessages,
} from "../api/admin";
import { downloadFile, fetchFileURL } from "../api/files";
import Avatar from "./Avatar";
import ImageModal from "./ImageModal";

function formatDate(ts) {
  if (!ts) return "never";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "—";
  }
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function kindOf(mime, filename) {
  const m = mime || "";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (/\.(jpe?g|png|gif|webp|avif)$/i.test(filename || "")) return "image";
  if (/\.(mp4|webm|mov|m4v)$/i.test(filename || "")) return "video";
  return "file";
}

function Row({ label, value }) {
  return (
    <div style={styles.row}>
      <span className="muted" style={styles.label}>
        {label}
      </span>
      <span style={styles.value}>{value}</span>
    </div>
  );
}

function Empty({ children }) {
  return (
    <div className="muted" style={{ textAlign: "center", padding: 28 }}>
      {children}
    </div>
  );
}

/** A chat this user belongs to. */
function ChatRow({ chat, me }) {
  const others = (chat.members || []).filter((m) => m !== me);
  const title = chat.name || others.join(", ") || "Saved messages";

  return (
    <div style={styles.item}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={styles.itemTitle}>
          {chat.is_secret ? "🔒 " : chat.is_group ? "👥 " : "💬 "}
          {title}
        </div>
        <div className="muted" style={styles.itemMeta}>
          {chat.is_secret ? "secret" : chat.is_group ? "group" : "direct"} ·{" "}
          {chat.message_count} messages ({chat.from_user} from them) ·{" "}
          last {formatDate(chat.last_activity)}
          {chat.self_destruct_seconds > 0 && ` · 🔥 ${chat.self_destruct_seconds}s`}
        </div>
      </div>
    </div>
  );
}

/** One message, with the conversation it was sent in. */
function MessageRow({ message, onOpenMedia }) {
  const others = message.members || [];
  const where =
    message.chat_name || (message.is_group ? "group" : others.join(", "));

  return (
    <div style={styles.item}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="muted" style={styles.itemMeta}>
          {message.is_secret ? "🔒 " : message.is_group ? "👥 " : "💬 "}
          {where} · {formatDate(message.created_at)} · {message.status}
          {message.expires_at && " · 🔥"}
        </div>

        <div dir="auto" style={styles.itemBody}>
          {message.is_encrypted
            ? `🔒 ciphertext (${message.content.length} chars) — not decryptable`
            : message.has_file
            ? null
            : message.content}
        </div>

        {message.has_file && !message.is_encrypted && (
          <button
            className="btn btn-secondary"
            style={styles.tiny}
            onClick={() => onOpenMedia(message)}
          >
            {kindOf(message.mime_type, message.filename) === "image"
              ? "🖼️"
              : kindOf(message.mime_type, message.filename) === "video"
              ? "🎬"
              : "📎"}{" "}
            {message.filename || "attachment"}
          </button>
        )}
      </div>
    </div>
  );
}

/** One library upload. */
function FileRow({ file, onOpen, onSave }) {
  return (
    <div style={styles.item}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={styles.itemTitle}>
          {file.visibility === "private" && "🔒 "}
          {file.title}
        </div>
        <div className="muted" style={styles.itemMeta}>
          {file.filename} · {formatBytes(file.size_bytes)} · {file.download_count} views ·{" "}
          {formatDate(file.created_at)}
        </div>
      </div>
      <div className="row" style={{ gap: 4, flexShrink: 0 }}>
        <button className="btn btn-secondary" style={styles.tiny} onClick={() => onOpen(file)}>
          👁
        </button>
        <button className="btn btn-secondary" style={styles.tiny} onClick={() => onSave(file)}>
          📥
        </button>
      </div>
    </div>
  );
}

/**
 * Everything the panel knows about one account.
 *
 * The counters are tabs, not decoration: a moderator who sees "412 messages"
 * needs to read them, so each one loads the underlying rows on demand. Loading
 * only the tab in view keeps opening the dialog cheap for an account with a
 * long history.
 *
 * The profile photo renders even when its owner set it to "contacts only" —
 * the avatar endpoint lets administrators through, and this is the view where
 * that matters.
 */
export default function AdminUserDetail({ userId, onClose }) {
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");

  const [chats, setChats] = useState(null);
  const [messages, setMessages] = useState(null);
  const [media, setMedia] = useState(null);
  const [files, setFiles] = useState(null);
  const [busy, setBusy] = useState(false);

  const [preview, setPreview] = useState(null);

  useEffect(() => {
    getUserDetail(userId)
      .then((d) => setUser(d.user))
      .catch((err) => setError(err.message));
  }, [userId]);

  // Each tab fetches once and keeps the result; re-opening it is instant, and
  // nothing is fetched for tabs the moderator never looks at.
  const loadTab = useCallback(
    async (next) => {
      setTab(next);
      setError("");

      const alreadyLoaded =
        (next === "chats" && chats) ||
        (next === "messages" && messages) ||
        (next === "media" && media) ||
        (next === "files" && files);
      if (alreadyLoaded || next === "overview" || next === "contacts") return;

      setBusy(true);
      try {
        if (next === "chats") setChats((await getUserChats(userId)).chats || []);
        if (next === "messages")
          setMessages((await getUserMessages(userId)).messages || []);
        if (next === "media")
          setMedia((await getUserMessages(userId, { mediaOnly: true })).messages || []);
        if (next === "files") setFiles((await getUserFiles(userId)).files || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    },
    [userId, chats, messages, media, files]
  );

  async function openChatMedia(message) {
    const kind = kindOf(message.mime_type, message.filename);
    try {
      const url = await fetchAdminMediaURL(message.id);
      if (kind === "image" || kind === "video") {
        setPreview({ url, filename: message.filename, kind });
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = message.filename || "file";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function openLibraryFile(file) {
    const kind = kindOf(file.mime_type, file.filename);
    if (kind !== "image" && kind !== "video") {
      await saveLibraryFile(file);
      return;
    }
    try {
      // No password: the server skips the check for administrators.
      const url = await fetchFileURL(file.id);
      setPreview({ url, filename: file.filename, kind });
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveLibraryFile(file) {
    try {
      await downloadFile(file.id, file.filename);
    } catch (err) {
      setError(err.message);
    }
  }

  const TABS = user
    ? [
        { id: "overview", label: "Overview" },
        { id: "chats", label: "Chats", count: user.chat_count },
        { id: "messages", label: "Messages", count: user.message_count },
        { id: "media", label: "Attachments", count: user.media_count },
        { id: "contacts", label: "Contacts", count: user.contact_count },
        { id: "files", label: "Library", count: user.public_file_count },
      ]
    : [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      {preview && (
        <ImageModal
          imageUrl={preview.url}
          filename={preview.filename}
          isVideo={preview.kind === "video"}
          onClose={() => {
            URL.revokeObjectURL(preview.url);
            setPreview(null);
          }}
          onDownload={() => {
            const a = document.createElement("a");
            a.href = preview.url;
            a.download = preview.filename || "file";
            document.body.appendChild(a);
            a.click();
            a.remove();
          }}
        />
      )}

      <div
        className="modal"
        style={{ maxWidth: 640 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: 20 }} className="stack">
          <div className="row" style={{ alignItems: "center", gap: 14 }}>
            <Avatar userId={userId} size={64} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 style={{ margin: 0 }}>{userId}</h3>
              {user && (
                <div className="muted" style={{ fontSize: 13 }}>
                  {user.is_admin ? "🛠️ Administrator" : "Regular user"}
                  {user.avatar_visibility === "contacts" && " · photo is contacts-only"}
                </div>
              )}
            </div>
          </div>

          {error && <div className="error-text">{error}</div>}
          {!user && !error && <div className="muted">Loading…</div>}

          {user && (
            <>
              <div className="row" style={{ gap: 5, flexWrap: "wrap" }}>
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    className={tab === t.id ? "btn" : "btn btn-secondary"}
                    style={styles.tab}
                    onClick={() => loadTab(t.id)}
                  >
                    {t.label}
                    {t.count !== undefined && (
                      <span style={styles.tabCount}>{t.count}</span>
                    )}
                  </button>
                ))}
              </div>

              {busy && <div className="muted">Loading…</div>}

              {tab === "overview" && (
                <div className="card stack" style={{ gap: 2 }}>
                  <Row label="Email" value={<span dir="ltr">{user.email}</span>} />
                  <Row
                    label="Phone"
                    value={
                      user.phone ? (
                        <span dir="ltr">
                          {user.phone}{" "}
                          {user.phone_verified ? "✅ verified" : "⏳ unverified"}
                        </span>
                      ) : (
                        "— none —"
                      )
                    }
                  />
                  {user.pending_phone && (
                    <Row
                      label="Pending phone"
                      value={<span dir="ltr">{user.pending_phone} (awaiting review)</span>}
                    />
                  )}
                  <Row label="Registered" value={formatDate(user.created_at)} />
                  <Row label="Last seen" value={formatDate(user.last_seen_at)} />
                  <Row
                    label="Encryption key"
                    value={user.has_keys ? "✅ present" : "— none —"}
                  />
                  <Row
                    label="Profile photo"
                    value={
                      user.has_avatar
                        ? `set · visibility: ${user.avatar_visibility}`
                        : "— none —"
                    }
                  />
                  <Row label="Secret chats" value={user.secret_chat_count} />
                  <Row label="Sessions invalidated" value={user.token_version} />
                  <Row label="Push devices" value={user.push_device_count} />
                </div>
              )}

              {tab === "chats" && !busy && (
                <div className="scroll-area stagger" style={styles.list}>
                  {(chats || []).map((ch) => (
                    <ChatRow key={ch.id} chat={ch} me={userId} />
                  ))}
                  {chats && chats.length === 0 && <Empty>Not in any chat.</Empty>}
                </div>
              )}

              {tab === "messages" && !busy && (
                <div className="scroll-area stagger" style={styles.list}>
                  {(messages || []).map((m) => (
                    <MessageRow key={m.id} message={m} onOpenMedia={openChatMedia} />
                  ))}
                  {messages && messages.length === 0 && (
                    <Empty>Has not sent any messages.</Empty>
                  )}
                </div>
              )}

              {tab === "media" && !busy && (
                <div className="scroll-area stagger" style={styles.list}>
                  {(media || []).map((m) => (
                    <MessageRow key={m.id} message={m} onOpenMedia={openChatMedia} />
                  ))}
                  {media && media.length === 0 && (
                    <Empty>Has not sent any attachments.</Empty>
                  )}
                </div>
              )}

              {tab === "contacts" && (
                <div className="scroll-area" style={styles.list}>
                  {user.contacts.length === 0 && <Empty>No contacts.</Empty>}
                  <div className="row" style={{ gap: 6, flexWrap: "wrap", padding: 4 }}>
                    {user.contacts.map((c) => (
                      <span key={c} className="badge">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {tab === "files" && !busy && (
                <div className="scroll-area stagger" style={styles.list}>
                  {(files || []).map((f) => (
                    <FileRow
                      key={f.id}
                      file={f}
                      onOpen={openLibraryFile}
                      onSave={saveLibraryFile}
                    />
                  ))}
                  {files && files.length === 0 && (
                    <Empty>Has not uploaded anything.</Empty>
                  )}
                </div>
              )}
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

const styles = {
  row: {
    display: "flex",
    gap: 10,
    padding: "6px 0",
    borderBottom: "1px solid var(--border)",
    fontSize: 13,
  },
  label: { minWidth: 140, flexShrink: 0 },
  value: { flex: 1, wordBreak: "break-word" },
  tab: { fontSize: 12, padding: "6px 11px", minHeight: 34 },
  tabCount: {
    marginInlineStart: 6,
    opacity: 0.75,
    fontVariantNumeric: "tabular-nums",
  },
  list: { maxHeight: "46vh", border: "1px solid var(--border)", borderRadius: 12 },
  item: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    padding: "9px 12px",
    borderBottom: "1px solid var(--border)",
  },
  itemTitle: { fontSize: 14, fontWeight: 600, wordBreak: "break-word" },
  itemMeta: { fontSize: 11, lineHeight: 1.6 },
  itemBody: {
    fontSize: 13,
    lineHeight: 1.6,
    marginTop: 2,
    wordBreak: "break-word",
    whiteSpace: "pre-wrap",
  },
  tiny: { fontSize: 11, padding: "3px 9px", minHeight: 26 },
};
