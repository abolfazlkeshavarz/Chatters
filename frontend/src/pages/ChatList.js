import { useCallback, useEffect, useState } from "react";
import { createChat, getChats, setChatMute } from "../api/chats";
import { addContact, getContacts, removeContact } from "../api/contacts";
import { chatSocket } from "../services/websocket";
import Avatar from "../components/Avatar";
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

// The "+" button opens this instead of jumping straight into a form — like
// Telegram's compose menu — because "add a contact" and "start a chat" are
// different enough actions that guessing which one the user wants is worse
// than a half-second menu.
function ComposeMenu({ onClose, onPick }) {
  const options = [
    { key: "contacts", icon: "👤", label: "Add contact" },
    { key: "direct", icon: "💬", label: "New chat" },
    { key: "group", icon: "👥", label: "New group" },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 300 }} onClick={(e) => e.stopPropagation()}>
        <div className="stack" style={{ padding: 8 }}>
          {options.map((opt) => (
            <button
              key={opt.key}
              className="btn btn-secondary"
              style={{ justifyContent: "flex-start", textAlign: "start" }}
              onClick={() => onPick(opt.key)}
            >
              <span style={{ marginInlineEnd: 10 }}>{opt.icon}</span>
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ContactRow({ contact, right }) {
  return (
    <div style={styles.contactRow}>
      <Avatar userId={contact.id} size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {contact.id}
        </div>
      </div>
      {right}
    </div>
  );
}

function AddContactModal({ onClose, onAdded, contacts, onRemove }) {
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const target = username.trim();
    if (!target) {
      setError("Enter a username");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await onAdded(target);
      setUsername("");
      setNotice(`Added ${target}`);
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
          <h3 style={{ margin: 0 }}>Contacts</h3>

          <div className="row">
            <input
              className="field"
              style={{ flex: 1 }}
              placeholder="Add by username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            <button className="btn" onClick={submit} disabled={busy}>
              {busy ? "…" : "Add"}
            </button>
          </div>

          {error && <div className="error-text">{error}</div>}
          {notice && <div className="muted">{notice}</div>}

          <div className="scroll-area" style={{ maxHeight: 320 }}>
            {contacts.length === 0 && (
              <div className="muted" style={{ padding: "12px 0" }}>
                No contacts yet.
              </div>
            )}
            {contacts.map((ct) => (
              <ContactRow
                key={ct.id}
                contact={ct}
                right={
                  <button
                    className="btn btn-secondary"
                    style={styles.smallBtn}
                    onClick={() => onRemove(ct.id)}
                    title="Remove"
                  >
                    ✕
                  </button>
                }
              />
            ))}
          </div>

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-secondary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Starting a chat or a group both pick from the same contact list — Telegram
// does not make you retype a username you already added. A direct chat
// creates immediately on tap; a group needs multiple picks plus a name, so it
// gets a checkbox list and an explicit Create button instead.
function PickContactsModal({ mode, contacts, onClose, onCreate, onOpenContacts }) {
  const isGroup = mode === "group";
  const [selected, setSelected] = useState([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function toggle(id) {
    if (!isGroup) {
      create([id]);
      return;
    }
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function create(members) {
    setBusy(true);
    setError("");
    try {
      await onCreate(members, isGroup, name.trim());
      onClose();
    } catch (err) {
      setError(err.message);
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

          {contacts.length === 0 ? (
            <div className="stack" style={{ alignItems: "center", padding: "16px 0" }}>
              <div className="muted">You have no contacts yet.</div>
              <button className="btn" onClick={onOpenContacts}>
                👤 Add a contact
              </button>
            </div>
          ) : (
            <div className="scroll-area" style={{ maxHeight: 320 }}>
              {contacts.map((ct) => {
                const isSelected = selected.includes(ct.id);
                return (
                  <button
                    key={ct.id}
                    className="list-row"
                    onClick={() => toggle(ct.id)}
                    disabled={busy}
                    style={{
                      ...styles.contactPickRow,
                      background: isSelected ? "var(--unread-bg)" : "transparent",
                    }}
                  >
                    <ContactRow
                      contact={ct}
                      right={
                        isGroup ? (
                          <span style={{ fontSize: 18 }}>{isSelected ? "☑️" : "⬜"}</span>
                        ) : null
                      }
                    />
                  </button>
                );
              })}
            </div>
          )}

          {error && <div className="error-text">{error}</div>}

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            {isGroup && (
              <button
                className="btn"
                onClick={() => create(selected)}
                disabled={busy || selected.length === 0}
              >
                {busy ? "Creating…" : `Create (${selected.length})`}
              </button>
            )}
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
  // 'menu' | 'contacts' | 'direct' | 'group' | null
  const [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState([]);

  const loadContacts = useCallback(async () => {
    try {
      const { contacts: list } = await getContacts();
      setContacts(list || []);
    } catch {
      // The picker just shows empty; the modal that manages contacts surfaces
      // its own errors when the user actually tries to add or remove one.
    }
  }, []);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  const load = useCallback(async () => {
    try {
      const list = (await getChats()) || [];
      setChats(list);
      setError("");
      return list;
    } catch (err) {
      setError(err.message || "Failed to load chats");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the list fresh: refresh on any inbound message and on reconnect, so
  // unread counts and previews are correct after the app returns from the
  // background. Also reacts to the E2E consent handshake — a request,
  // acceptance or rejection changes a chat's encryption state and, for the
  // conversation currently open, has to update immediately rather than
  // waiting for the next reload.
  useEffect(() => {
    chatSocket.start();

    const offMessage = chatSocket.onMessage((msg) => {
      if (msg.type === "message" || msg.type === "media") {
        load();
        return;
      }

      if (msg.type === "e2e_request" || msg.type === "e2e_accepted" || msg.type === "e2e_rejected") {
        load();
        setActive((prev) => {
          if (!prev || prev.id !== msg.chat_id) return prev;
          if (msg.type === "e2e_request") {
            return { ...prev, e2e_status: "pending", e2e_requested_by: msg.by };
          }
          if (msg.type === "e2e_accepted") {
            return { ...prev, e2e_status: "accepted", e2e_enabled: true };
          }
          return { ...prev, e2e_status: "none", e2e_requested_by: null };
        });
      }
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
    const { chat_id: chatId } = await createChat(members, isGroup, name);
    const freshChats = await load();

    // Direct chats jump straight in, matching how picking a contact felt like
    // "start this conversation" rather than "create an entry in a list I now
    // have to go find". Groups stay on the list, since after naming and
    // multi-selecting, landing back where the new group is visible in the
    // list is the more natural confirmation.
    if (!isGroup && chatId) {
      const created = freshChats.find((c) => c.id === chatId);
      if (created) setActive(created);
    }
  }

  async function handleAddContact(username) {
    await addContact(username);
    await loadContacts();
  }

  async function handleRemoveContact(userId) {
    await removeContact(userId);
    await loadContacts();
  }

  function closeChat() {
    setActive(null);
    load();
  }

  async function toggleMute(chat, e) {
    e.stopPropagation();
    const next = !chat.muted;
    // Optimistic: this is a pure preference toggle with no correctness
    // consequence if it briefly disagrees with the server.
    setChats((prev) => prev.map((c) => (c.id === chat.id ? { ...c, muted: next } : c)));
    try {
      await setChatMute(chat.id, next);
    } catch {
      setChats((prev) => prev.map((c) => (c.id === chat.id ? { ...c, muted: !next } : c)));
    }
  }

  if (active) {
    // Encryption is a property of the conversation, so the secure page simply
    // replaces the normal one once it is switched on.
    const Page = active.e2e_enabled ? SecureChat : Chat;
    return (
      <Page
        chatId={active.id}
        title={chatTitle(active, me)}
        chat={active}
        onBack={closeChat}
        onChatPatch={(patch) =>
          setActive((prev) => (prev && prev.id === active.id ? { ...prev, ...patch } : prev))
        }
        onSecured={async () => {
          await load();
          setActive((prev) => (prev ? { ...prev, e2e_enabled: true } : prev));
        }}
      />
    );
  }

  return (
    <div className="pane">
      {modal === "menu" && (
        <ComposeMenu
          onClose={() => setModal(null)}
          onPick={(key) => {
            // Refreshed on open rather than trusted from mount: a contact
            // added from another tab or device must not silently be missing
            // from the picker.
            loadContacts();
            setModal(key);
          }}
        />
      )}

      {modal === "contacts" && (
        <AddContactModal
          contacts={contacts}
          onClose={() => setModal(null)}
          onAdded={handleAddContact}
          onRemove={handleRemoveContact}
        />
      )}

      {(modal === "direct" || modal === "group") && (
        <PickContactsModal
          mode={modal}
          contacts={contacts}
          onClose={() => setModal(null)}
          onCreate={handleCreate}
          onOpenContacts={() => setModal("contacts")}
        />
      )}

      <div className="app-header">
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Chats</h2>
          <div className="muted">
            Logged in as <strong>{me}</strong>
          </div>
        </div>
        <button
          className="btn"
          style={styles.composeBtn}
          onClick={() => setModal("menu")}
          aria-label="New"
          title="New chat, group or contact"
        >
          +
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
            // A <div> rather than a <button>: it contains the real mute
            // <button> below, and nested buttons are invalid HTML — the
            // browser would auto-close this one at the first nested tag and
            // break the click target for the rest of the card.
            <div
              key={chat.id}
              className="list-row"
              role="button"
              tabIndex={0}
              onClick={() => setActive(chat)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setActive(chat);
              }}
              style={{
                ...styles.chatCard,
                background: unread ? "var(--unread-bg)" : "var(--card)",
              }}
            >
              {chat.is_group ? (
                <div style={styles.avatar}>{title[0]?.toUpperCase() || "?"}</div>
              ) : (
                <Avatar userId={title} size={46} style={{ fontSize: 18 }} />
              )}

              <div style={styles.chatBody}>
                <div style={styles.chatTop}>
                  <div style={styles.chatTitle}>
                    {chat.e2e_enabled && <span title="End-to-end encrypted">🔒 </span>}
                    {title}
                    {chat.is_group && <span className="badge"> group</span>}
                    {chat.muted && <span title="Muted" style={{ opacity: 0.5 }}> 🔕</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={(e) => toggleMute(chat, e)}
                      title={chat.muted ? "Unmute" : "Mute notifications"}
                      style={styles.muteBtn}
                    >
                      {chat.muted ? "🔕" : "🔔"}
                    </button>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {formatTime(chat.last_message_time)}
                    </div>
                  </div>
                </div>

                {chat.e2e_status === "pending" && (
                  <div style={styles.pendingHint}>
                    {chat.e2e_requested_by === me
                      ? "🔒 Waiting for them to accept encryption…"
                      : "🔒 Wants to start an encrypted chat — open to respond"}
                  </div>
                )}

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
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  list: { padding: "0 12px 12px" },
  empty: { textAlign: "center", padding: 40, color: "var(--subtext)" },
  composeBtn: {
    width: 40,
    height: 40,
    borderRadius: "50%",
    fontSize: 22,
    lineHeight: 1,
    padding: 0,
    flexShrink: 0,
  },
  contactRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 4px",
  },
  contactPickRow: {
    display: "block",
    width: "100%",
    border: "none",
    borderRadius: 10,
    padding: "2px 6px",
    textAlign: "start",
    cursor: "pointer",
  },
  smallBtn: {
    padding: "4px 8px",
    fontSize: 12,
  },
  muteBtn: {
    border: "none",
    background: "none",
    padding: 2,
    fontSize: 14,
    cursor: "pointer",
    lineHeight: 1,
  },
  pendingHint: {
    fontSize: 12,
    color: "var(--secure, #30b06a)",
    marginTop: 2,
    marginBottom: 2,
  },
  chatCard: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    padding: 12,
    marginBottom: 8,
    borderRadius: 14,
    border: "1px solid var(--border)",
    boxShadow: "var(--shadow-sm)",
    textAlign: "start",
    cursor: "pointer",
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
