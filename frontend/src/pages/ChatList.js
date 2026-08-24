import { useCallback, useEffect, useState } from "react";
import { createChat, getChats } from "../api/chats";
import { chatSocket } from "../services/websocket";
import Chat from "./Chat";
import SecureChat from "./SecureChat";

function formatTime(timestamp) {
  if (!timestamp) return "";
  try {
    const date = new Date(timestamp);
    const diffMs = Date.now() - date.getTime();
    const mins = Math.floor(diffMs / 60000);
    const days = Math.floor(diffMs / 86400000);

    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m`;
    if (days === 0) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (days === 1) return "Yesterday";
    if (days < 7) return date.toLocaleDateString([], { weekday: "short" });
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function chatTitle(chat, me) {
  const others = (chat.members || []).filter((u) => u !== me);
  if (chat.is_group) return chat.name || others.join(", ") || "Group";
  return others[0] || "Saved messages";
}

function NewChatModal({ mode, onClose, onCreate }) {
  const [members, setMembers] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isGroup = mode === "group";

  async function submit() {
    const list = members
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);

    if (list.length === 0) {
      setError("Enter at least one username");
      return;
    }
    if (!isGroup && list.length > 1) {
      setError("A direct chat takes exactly one username");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await onCreate(list, isGroup, name.trim());
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: 20 }} className="stack">
          <h3 style={{ margin: 0 }}>{isGroup ? "New group" : "New chat"}</h3>

          {isGroup && (
            <input
              className="field"
              placeholder="Group name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}

          <input
            className="field"
            placeholder={isGroup ? "user1, user2, user3" : "username"}
            value={members}
            onChange={(e) => setMembers(e.target.value)}
          />
          <div className="muted">
            آیدی خودتو نزن — فقط آیدی مخاطباتو بزن
          </div>

          {error && <div className="error-text">{error}</div>}

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn" onClick={submit} disabled={busy}>
              {busy ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ChatList({ initialChatId }) {
  const me = localStorage.getItem("username");

  const [chats, setChats] = useState([]);
  const [active, setActive] = useState(null);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setChats((await getChats()) || []);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load chats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the list fresh: refresh on any inbound message and on reconnect, so
  // unread counts and previews are correct after the app returns from the
  // background.
  useEffect(() => {
    chatSocket.start();

    const offMessage = chatSocket.onMessage((msg) => {
      if (msg.type === "message" || msg.type === "media") load();
    });
    const offStatus = chatSocket.onStatus((s) => {
      if (s === "reconnected") load();
    });

    return () => {
      offMessage();
      offStatus();
    };
  }, [load]);

  // Deep link from a tapped notification.
  useEffect(() => {
    if (!initialChatId || chats.length === 0) return;
    const chat = chats.find((c) => c.id === initialChatId);
    if (chat) setActive(chat);
  }, [initialChatId, chats]);

  async function handleCreate(members, isGroup, name) {
    await createChat(members, isGroup, name);
    await load();
  }

  function closeChat() {
    setActive(null);
    load();
  }

  if (active) {
    // Encryption is a property of the conversation, so the secure page simply
    // replaces the normal one once it is switched on.
    const Page = active.e2e_enabled ? SecureChat : Chat;
    return (
      <Page
        chatId={active.id}
        title={chatTitle(active, me)}
        onBack={closeChat}
        onSecured={async () => {
          await load();
          setActive((prev) => (prev ? { ...prev, e2e_enabled: true } : prev));
        }}
      />
    );
  }

  return (
    <div className="pane">
      {modal && (
        <NewChatModal
          mode={modal}
          onClose={() => setModal(null)}
          onCreate={handleCreate}
        />
      )}

      <div className="app-header">
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Chats</h2>
          <div className="muted">
            Logged in as <strong>{me}</strong>
          </div>
        </div>
      </div>

      <div style={styles.actions}>
        <button className="btn" style={{ flex: 1 }} onClick={() => setModal("direct")}>
          + New chat
        </button>
        <button
          className="btn btn-secondary"
          style={{ flex: 1 }}
          onClick={() => setModal("group")}
        >
          + New group
        </button>
      </div>

      {error && (
        <div className="error-text" style={{ padding: "0 12px" }}>
          {error}
        </div>
      )}

      <div className="scroll-area" style={styles.list}>
        {loading && <div style={styles.empty}>Loading…</div>}

        {!loading && chats.length === 0 && (
          <div style={styles.empty}>
            <div style={{ fontSize: 40 }}>💬</div>
            <div>No chats yet</div>
            <div className="muted">Start a conversation above</div>
          </div>
        )}

        {chats.map((chat) => {
          const title = chatTitle(chat, me);
          const unread = chat.unread_count > 0;

          let preview;
          if (chat.last_is_encrypted) {
            preview = "🔒 Encrypted message";
          } else if (chat.last_message) {
            const prefix =
              chat.last_message_sender === me
                ? "You: "
                : chat.is_group && chat.last_message_sender
                ? `${chat.last_message_sender}: `
                : "";
            preview = prefix + chat.last_message;
          } else {
            preview = "No messages yet";
          }

          if (preview.length > 42) preview = `${preview.slice(0, 40)}…`;

          return (
            <button
              key={chat.id}
              onClick={() => setActive(chat)}
              style={{
                ...styles.chatCard,
                background: unread ? "var(--unread-bg)" : "var(--card)",
              }}
            >
              <div style={styles.avatar}>{title[0]?.toUpperCase() || "?"}</div>

              <div style={styles.chatBody}>
                <div style={styles.chatTop}>
                  <div style={styles.chatTitle}>
                    {chat.e2e_enabled && <span title="End-to-end encrypted">🔒 </span>}
                    {title}
                    {chat.is_group && <span className="badge"> group</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 12, flexShrink: 0 }}>
                    {formatTime(chat.last_message_time)}
                  </div>
                </div>

                <div style={styles.chatBottom}>
                  <div
                    style={{
                      ...styles.preview,
                      fontWeight: unread ? 600 : 400,
                      color: unread ? "var(--text)" : "var(--subtext)",
                    }}
                  >
                    {preview}
                  </div>
                  {unread && (
                    <div style={styles.unread}>
                      {chat.unread_count > 9 ? "9+" : chat.unread_count}
                    </div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  actions: { display: "flex", gap: 8, padding: 12, flexShrink: 0 },
  list: { padding: "0 12px 12px" },
  empty: { textAlign: "center", padding: 40, color: "var(--subtext)" },
  chatCard: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    padding: 12,
    marginBottom: 8,
    borderRadius: 14,
    border: "1px solid var(--border)",
    textAlign: "start",
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: "50%",
    background: "var(--primary)",
    color: "#fff",
    display: "grid",
    placeItems: "center",
    fontSize: 18,
    fontWeight: 600,
    flexShrink: 0,
  },
  chatBody: { flex: 1, minWidth: 0 },
  chatTop: { display: "flex", justifyContent: "space-between", gap: 8 },
  chatTitle: {
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  chatBottom: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  preview: {
    fontSize: 13,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  unread: {
    minWidth: 20,
    height: 20,
    padding: "0 6px",
    borderRadius: 10,
    background: "var(--primary)",
    color: "#fff",
    fontSize: 12,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  },
};
