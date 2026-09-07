import { useState } from "react";
import { useChat } from "../hooks/useChat";
import { uploadMedia } from "../api/media";
import { createSecretChat, setChatMute } from "../api/chats";
import { deleteMessage } from "../api/messages";
import Avatar from "../components/Avatar";
import MessageList from "../components/MessageList";
import Composer from "../components/Composer";
import ConnectionBanner from "../components/ConnectionBanner";

/**
 * Standard (unencrypted) conversation. Messages are stored in cleartext and are
 * therefore visible to the server operator.
 *
 * Encryption is no longer an in-place upgrade of this chat. The 🔒 button
 * starts a separate Telegram-style secret chat with the other person (a new
 * conversation, pending until they accept); this chat stays exactly as it is.
 */
export default function Chat({ chatId, title, chat, onBack, onChatPatch, onOpenChat }) {
  const me = localStorage.getItem("username");
  const [replyTo, setReplyTo] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const { messages, status, error: chatError, setError: setChatError, send } = useChat({ chatId });

  const otherMember = (chat?.members || []).find((m) => m !== me);

  async function handleAttach(file) {
    try {
      await uploadMedia(chatId, file);
    } catch (err) {
      setChatError(err.message || "آپلود فایل ناموفق بود");
    }
  }

  async function handleSend(text) {
    const ok = await send(text, replyTo?.id);
    if (ok) setReplyTo(null);
    return ok;
  }

  async function handleDelete(message, scope) {
    try {
      await deleteMessage(message.id, scope);
    } catch (err) {
      setChatError(err.message || "Could not delete the message");
    }
  }

  async function handleStartSecret() {
    if (chat?.is_group) {
      setError("Secret chats are one-to-one only.");
      return;
    }
    if (
      !window.confirm(
        "Start a secret chat with this person?\n\n" +
          "It opens as a separate, end-to-end encrypted conversation once they " +
          "accept. This chat is unchanged."
      )
    ) {
      return;
    }

    setBusy(true);
    setError("");
    try {
      const { chat_id: secretId } = await createSecretChat(otherMember);
      setNotice("Secret chat request sent.");
      onOpenChat?.(secretId);
    } catch (err) {
      setError(err.message || "Could not start the secret chat");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleMute() {
    const next = !chat?.muted;
    onChatPatch?.({ muted: next });
    try {
      await setChatMute(chatId, next);
    } catch (err) {
      onChatPatch?.({ muted: !next });
      setError(err.message || "Could not update mute setting");
    }
  }

  return (
    <div className="pane">
      <div className="app-header">
        {onBack && (
          <button onClick={onBack} style={styles.back} aria-label="Back">
            ←
          </button>
        )}

        {!chat?.is_group && <Avatar userId={title} size={32} />}

        <div style={styles.titleBox}>
          <div style={styles.title}>{title}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Not encrypted
          </div>
        </div>

        <button
          onClick={handleToggleMute}
          title={chat?.muted ? "Unmute notifications" : "Mute notifications"}
          style={styles.muteBtn}
        >
          {chat?.muted ? "🔕" : "🔔"}
        </button>

        {!chat?.is_group && (
          <button
            className="badge"
            onClick={handleStartSecret}
            disabled={busy}
            title="Start a secret (end-to-end encrypted) chat"
          >
            {busy ? "…" : "🔒 Secret chat"}
          </button>
        )}
      </div>

      <ConnectionBanner status={status} />

      {(error || chatError || notice) && (
        <div
          style={styles.notice}
          onClick={() => {
            setError("");
            setChatError("");
            setNotice("");
          }}
        >
          {error || chatError || notice}
        </div>
      )}

      <MessageList
        messages={messages}
        me={me}
        onReply={setReplyTo}
        onDelete={handleDelete}
      />

      <Composer
        onSend={handleSend}
        onAttach={handleAttach}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
      />
    </div>
  );
}

const styles = {
  back: { fontSize: 24, minWidth: 40, padding: 8 },
  titleBox: { flex: 1, minWidth: 0 },
  title: {
    fontSize: 16,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  notice: {
    padding: "8px 12px",
    background: "var(--unread-bg)",
    color: "var(--text)",
    fontSize: 13,
    cursor: "pointer",
    flexShrink: 0,
  },
  muteBtn: {
    border: "none",
    background: "none",
    fontSize: 18,
    padding: 8,
    cursor: "pointer",
    lineHeight: 1,
  },
};
