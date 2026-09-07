import { useCallback, useEffect, useRef, useState } from "react";
import {
  listChats,
  getChatMessages,
  deleteChatAdmin,
  deleteMessageAdmin,
  fetchAdminMediaURL,
} from "../api/admin";
import ImageModal from "../components/ImageModal";

const PAGE_SIZE = 30;

function attachmentKind(message) {
  const mime = message.mime_type || "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  const name = message.filename || "";
  if (/\.(jpe?g|png|gif|webp|avif|bmp)$/i.test(name)) return "image";
  if (/\.(mp4|webm|mov|m4v|mkv)$/i.test(name)) return "video";
  if (/\.(mp3|wav|ogg|m4a)$/i.test(name)) return "audio";
  return "file";
}

/**
 * A chat attachment, opened through the admin endpoint that skips the
 * membership check.
 *
 * Loaded on demand rather than eagerly: opening a transcript should not pull
 * every attachment in it down the wire, and each fetch is written to the audit
 * log — so a click here is a deliberate, recorded act.
 */
function AdminAttachment({ message, onError }) {
  const kind = attachmentKind(message);
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(false);

  const urlRef = useRef(null);
  useEffect(() => {
    urlRef.current = url;
  }, [url]);
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    []
  );

  async function open() {
    if (url) {
      setPreview(true);
      return;
    }
    setLoading(true);
    try {
      const u = await fetchAdminMediaURL(message.id);
      setUrl(u);
      if (kind === "image" || kind === "video") setPreview(true);
    } catch (err) {
      onError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function save() {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = message.filename || "file";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const icon = { image: "🖼️", video: "🎬", audio: "🎵", file: "📎" }[kind];

  return (
    <div style={{ marginTop: 4 }}>
      {preview && url && (kind === "image" || kind === "video") && (
        <ImageModal
          imageUrl={url}
          filename={message.filename}
          isVideo={kind === "video"}
          onClose={() => setPreview(false)}
          onDownload={save}
        />
      )}

      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13 }}>
          {icon} {message.filename || message.content}
        </span>
        <button
          className="btn btn-secondary"
          style={{ fontSize: 11, padding: "3px 9px" }}
          onClick={open}
          disabled={loading}
        >
          {loading ? "…" : url ? "View" : "Open"}
        </button>
        {url && (
          <button
            className="btn btn-secondary"
            style={{ fontSize: 11, padding: "3px 9px" }}
            onClick={save}
          >
            📥
          </button>
        )}
      </div>

      {url && kind === "image" && (
        <img
          src={url}
          alt={message.filename}
          style={styles.thumb}
          onClick={() => setPreview(true)}
        />
      )}
      {url && kind === "video" && (
        <video src={url} style={styles.thumb} controls preload="metadata" />
      )}
      {url && kind === "audio" && (
        <audio src={url} controls style={{ marginTop: 6, width: "100%", maxWidth: 300 }} />
      )}
    </div>
  );
}

function fmt(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

function chatLabel(chat) {
  if (chat.name) return chat.name;
  return chat.members.join(", ");
}

function chatKind(chat) {
  if (chat.is_secret) return "secret";
  if (chat.is_group) return "group";
  return "direct";
}

/**
 * The moderator view over every conversation on the server. Encrypted message
 * bodies are shown as the stored ciphertext and flagged — the server has no
 * key to decrypt them — but everything can still be deleted.
 */
export default function AdminChats({ onNotice, onError }) {
  const [chats, setChats] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const [openChat, setOpenChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [msgLoading, setMsgLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listChats({
        search,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setChats(data.chats || []);
      setTotal(data.total || 0);
    } catch (err) {
      onError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search, page, onError]);

  useEffect(() => {
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
  }, [refresh]);

  const loadMessages = useCallback(
    async (chat) => {
      setOpenChat(chat);
      setMsgLoading(true);
      setMessages([]);
      try {
        const data = await getChatMessages(chat.id, { limit: 300 });
        setMessages(data.messages || []);
      } catch (err) {
        onError(err.message);
      } finally {
        setMsgLoading(false);
      }
    },
    [onError]
  );

  async function handleDeleteChat(chat) {
    if (
      !window.confirm(
        `Delete "${chatLabel(chat)}" and all ${chat.message_count} of its messages, for every member? This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      await deleteChatAdmin(chat.id);
      onNotice(`Deleted chat ${chat.id}`);
      if (openChat?.id === chat.id) setOpenChat(null);
      refresh();
    } catch (err) {
      onError(err.message);
    }
  }

  async function handleDeleteMessage(m) {
    if (!window.confirm("Delete this message for everyone?")) return;
    try {
      await deleteMessageAdmin(m.id);
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
      onNotice(`Deleted message #${m.id}`);
      refresh();
    } catch (err) {
      onError(err.message);
    }
  }

  const pages = Math.ceil(total / PAGE_SIZE) || 1;

  return (
    <div className="stack">
      <div className="row">
        <input
          className="field"
          style={{ flex: 1, minWidth: 200 }}
          placeholder="Search by chat id, group name, or member username"
          value={search}
          onChange={(e) => {
            setPage(0);
            setSearch(e.target.value);
          }}
        />
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Chat</th>
                <th className="hide-sm">Kind</th>
                <th className="hide-sm">Members</th>
                <th>Msgs</th>
                <th className="hide-sm">Last activity</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: 16 }}>
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && chats.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: 16 }}>
                    No chats found
                  </td>
                </tr>
              )}
              {!loading &&
                chats.map((chat) => (
                  <tr key={chat.id}>
                    <td>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: "2px 8px", fontSize: 13 }}
                        onClick={() => loadMessages(chat)}
                      >
                        {chatLabel(chat)}
                      </button>
                      {chat.self_destruct_seconds > 0 && (
                        <span className="badge" title="Self-destruct timer"> 🔥</span>
                      )}
                    </td>
                    <td className="hide-sm">
                      <span className={`badge ${chat.is_secret ? "badge-secure" : ""}`}>
                        {chatKind(chat)}
                      </span>
                    </td>
                    <td className="hide-sm" style={{ fontSize: 12 }}>
                      {chat.members.join(", ")}
                    </td>
                    <td>{chat.message_count}</td>
                    <td className="hide-sm" style={{ fontSize: 12 }}>
                      {fmt(chat.last_activity)}
                    </td>
                    <td>
                      <button
                        className="btn btn-danger"
                        style={{ padding: "2px 8px", fontSize: 12 }}
                        onClick={() => handleDeleteChat(chat)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {pages > 1 && (
        <div className="row" style={{ justifyContent: "center", gap: 12 }}>
          <button
            className="btn btn-secondary"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            ‹ Prev
          </button>
          <span className="muted">
            {page + 1} / {pages}
          </span>
          <button
            className="btn btn-secondary"
            disabled={page + 1 >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next ›
          </button>
        </div>
      )}

      {openChat && (
        <div className="modal-overlay" onClick={() => setOpenChat(null)}>
          <div
            className="modal"
            style={{ maxWidth: 640, width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: 16 }} className="stack">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h3 style={{ margin: 0 }}>{chatLabel(openChat)}</h3>
                <button className="btn btn-secondary" onClick={() => setOpenChat(null)}>
                  Close
                </button>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {chatKind(openChat)} · {openChat.members.join(", ")} ·{" "}
                {openChat.message_count} messages
              </div>

              <div className="scroll-area" style={{ maxHeight: "55vh" }}>
                {msgLoading && <div className="muted">Loading messages…</div>}
                {!msgLoading && messages.length === 0 && (
                  <div className="muted">No messages.</div>
                )}
                {messages.map((m) => (
                  <div key={m.id} style={styles.msgRow}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={styles.msgMeta}>
                        <strong>{m.from || "system"}</strong>
                        <span> · {fmt(m.created_at)}</span>
                        {m.is_encrypted && <span className="badge badge-secure"> encrypted</span>}
                        {m.has_file && <span className="badge"> file</span>}
                        {m.expires_at && <span className="badge"> 🔥</span>}
                      </div>
                      <div dir="auto" style={styles.msgBody}>
                        {m.is_encrypted
                          ? `🔒 ciphertext (${m.content.length} chars) — not decryptable here`
                          : m.has_file
                          ? null
                          : m.content}
                      </div>

                      {/* Attachments are viewable, not just named: an admin who
                          can already read every message body gains nothing from
                          being shown only a filename. */}
                      {m.has_file && !m.is_encrypted && (
                        <AdminAttachment message={m} onError={onError} />
                      )}
                    </div>
                    <button
                      className="btn btn-danger"
                      style={{ padding: "2px 8px", fontSize: 12, flexShrink: 0 }}
                      onClick={() => handleDeleteMessage(m)}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>

              <button
                className="btn btn-danger btn-block"
                onClick={() => handleDeleteChat(openChat)}
              >
                Delete entire chat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  thumb: {
    display: "block",
    marginTop: 6,
    maxWidth: 240,
    maxHeight: 180,
    borderRadius: 8,
    objectFit: "cover",
    cursor: "pointer",
    background: "#000",
  },
  msgRow: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    padding: "8px 0",
    borderBottom: "1px solid var(--border)",
  },
  msgMeta: { fontSize: 12, color: "var(--subtext)", marginBottom: 2 },
  msgBody: { fontSize: 14, whiteSpace: "pre-wrap", wordBreak: "break-word" },
};
