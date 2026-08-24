import { useState } from "react";
import { useChat } from "../hooks/useChat";
import { uploadMedia } from "../api/media";
import { enableE2E } from "../api/chats";
import MessageList from "../components/MessageList";
import Composer from "../components/Composer";
import ConnectionBanner from "../components/ConnectionBanner";

/**
 * Standard (unencrypted) conversation. Messages are stored in cleartext and
 * are therefore visible to the server operator — the "Secure chat" action
 * upgrades the conversation, which swaps in the SecureChat page.
 */
export default function Chat({ chatId, title, onBack, onSecured }) {
  const me = localStorage.getItem("username");
  const [replyTo, setReplyTo] = useState(null);
  const [notice, setNotice] = useState("");
  const [securing, setSecuring] = useState(false);

  const { messages, status, error, setError, send } = useChat({ chatId });

  async function handleAttach(file) {
    try {
      await uploadMedia(chatId, file);
    } catch (err) {
      setError(err.message || "آپلود فایل ناموفق بود");
    }
  }

  async function handleSend(text) {
    const ok = await send(text, replyTo?.id);
    if (ok) setReplyTo(null);
    return ok;
  }

  async function handleEnableE2E() {
    if (
      !window.confirm(
        "Turn on end-to-end encryption for this chat?\n\n" +
          "New messages will be readable only by the members of this chat — " +
          "not by the server or an administrator.\n\n" +
          "Messages already sent stay unencrypted, and this cannot be undone."
      )
    ) {
      return;
    }

    setSecuring(true);
    setError("");
    try {
      await enableE2E(chatId);
      onSecured();
    } catch (err) {
      setError(err.message || "Could not enable encryption");
    } finally {
      setSecuring(false);
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

        <div style={styles.titleBox}>
          <div style={styles.title}>{title}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Not encrypted
          </div>
        </div>

        <button
          className="badge"
          onClick={handleEnableE2E}
          disabled={securing}
          title="Enable end-to-end encryption"
        >
          {securing ? "…" : "🔒 Secure chat"}
        </button>
      </div>

      <ConnectionBanner status={status} />

      {(error || notice) && (
        <div style={styles.notice} onClick={() => { setError(""); setNotice(""); }}>
          {error || notice}
        </div>
      )}

      <MessageList messages={messages} me={me} onReply={setReplyTo} />

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
};
