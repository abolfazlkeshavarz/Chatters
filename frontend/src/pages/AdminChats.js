import { useCallback, useEffect, useState } from "react";
import {
  listChats,
  getChatMessages,
  deleteChatAdmin,
  deleteMessageAdmin,
} from "../api/admin";

const PAGE_SIZE = 30;

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
                          : m.type === "media"
                          ? `📎 ${m.filename || m.content}`
                          : m.content}
                      </div>
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
