import { useState } from "react";
import { useChat } from "../hooks/useChat";
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

  const {
    messages,
    status,
    error: chatError,
    setError: setChatError,
    send,
    sendMedia,
    retryMedia,
  } = useChat({ chatId });

  const otherMember = (chat?.members || []).find((m) => m !== me);

  // sendMedia manages its own optimistic bubble and per-file progress, so all
  // this has to do is fan a multi-select out into one upload each.
  function handleAttach(files) {
    const list = Array.isArray(files) ? files : [files];
    for (const file of list) {
      if (file) sendMedia(file, replyTo?.id);
    }
    setReplyTo(null);
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
      setChatError(err.message || "حذف پیام ناموفق بود");
    }
  }

  async function handleStartSecret() {
    if (chat?.is_group) {
      setError("گفتگوی محرمانه فقط بین دو نفر ممکن است.");
      return;
    }
    if (
      !window.confirm(
        "با این شخص گفتگوی محرمانه شروع شود؟\n\n" +
          "پس از پذیرش او، یک گفتگوی جداگانه با رمزنگاری سرتاسری باز می‌شود. " +
          "این گفتگو بدون تغییر می‌ماند."
      )
    ) {
      return;
    }

    setBusy(true);
    setError("");
    try {
      const { chat_id: secretId } = await createSecretChat(otherMember);
      setNotice("درخواست گفتگوی محرمانه ارسال شد.");
      onOpenChat?.(secretId);
    } catch (err) {
      setError(err.message || "شروع گفتگوی محرمانه ناموفق بود");
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
      setError(err.message || "تغییر تنظیم بی‌صدا ناموفق بود");
    }
  }

  return (
    <div className="pane">
      <div className="app-header">
        {onBack && (
          <button onClick={onBack} style={styles.back} aria-label="بازگشت">
            ←
          </button>
        )}

        {!chat?.is_group && <Avatar userId={title} size={32} />}

        <div style={styles.titleBox}>
          <div style={styles.title}>{title}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            بدون رمزنگاری
          </div>
        </div>

        <button
          onClick={handleToggleMute}
          title={chat?.muted ? "فعال کردن اعلان‌ها" : "بی‌صدا کردن اعلان‌ها"}
          style={styles.muteBtn}
        >
          {chat?.muted ? "🔕" : "🔔"}
        </button>

        {!chat?.is_group && (
          <button
            className="badge"
            onClick={handleStartSecret}
            disabled={busy}
            title="شروع گفتگوی محرمانه (رمزنگاری سرتاسری)"
          >
            {busy ? "…" : "🔒 گفتگوی محرمانه"}
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
        onRetryMedia={retryMedia}
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
