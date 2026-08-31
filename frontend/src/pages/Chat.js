import { useState } from "react";
import { useChat } from "../hooks/useChat";
import { uploadMedia } from "../api/media";
import { requestE2E, acceptE2E, rejectE2E, setChatMute } from "../api/chats";
import Avatar from "../components/Avatar";
import MessageList from "../components/MessageList";
import Composer from "../components/Composer";
import ConnectionBanner from "../components/ConnectionBanner";

/**
 * Standard (unencrypted) conversation. Messages are stored in cleartext and
 * are therefore visible to the server operator.
 *
 * Turning on encryption is a two-step consent handshake, not a unilateral
 * switch: either side can request it (the 🔒 button), but the chat only
 * upgrades to SecureChat once the OTHER member explicitly accepts — shown as
 * a banner at the top of their chat. This exists because a one-sided switch
 * let a compromised or malicious account "secure" a conversation the other
 * person never agreed to, at a time of the attacker's choosing.
 */
export default function Chat({ chatId, title, chat, onBack, onChatPatch, onSecured }) {
  const me = localStorage.getItem("username");
  const [replyTo, setReplyTo] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const { messages, status, error: chatError, setError: setChatError, send } = useChat({ chatId });

  const e2eStatus = chat?.e2e_status || "none";
  const requestedByMe = chat?.e2e_requested_by === me;
  const iCanRespond = e2eStatus === "pending" && !requestedByMe;

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

  async function handleRequest() {
    if (
      !window.confirm(
        "Ask to turn on end-to-end encryption for this chat?\n\n" +
          "The other person will see a request they can accept or reject. " +
          "Once accepted, new messages are readable only by the members of " +
          "this chat — not by the server or an administrator.\n\n" +
          "Messages already sent stay unencrypted, and this cannot be undone."
      )
    ) {
      return;
    }

    setBusy(true);
    setError("");
    try {
      await requestE2E(chatId);
      onChatPatch?.({ e2e_status: "pending", e2e_requested_by: me });
      setNotice("Request sent. Waiting for them to accept…");
    } catch (err) {
      setError(err.message || "Could not send the request");
    } finally {
      setBusy(false);
    }
  }

  async function handleAccept() {
    setBusy(true);
    setError("");
    try {
      await acceptE2E(chatId);
      onChatPatch?.({ e2e_status: "accepted", e2e_enabled: true });
      onSecured?.();
    } catch (err) {
      setError(err.message || "Could not accept the request");
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    setBusy(true);
    setError("");
    try {
      await rejectE2E(chatId);
      onChatPatch?.({ e2e_status: "none", e2e_requested_by: null });
    } catch (err) {
      setError(err.message || "Could not reject the request");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleMute() {
    const next = !chat?.muted;
    onChatPatch?.({ muted: next }); // optimistic: pure preference, no correctness risk
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
            {e2eStatus === "pending"
              ? requestedByMe
                ? "Encryption request sent"
                : "Wants to enable encryption"
              : "Not encrypted"}
          </div>
        </div>

        <button
          onClick={handleToggleMute}
          title={chat?.muted ? "Unmute notifications" : "Mute notifications"}
          style={styles.muteBtn}
        >
          {chat?.muted ? "🔕" : "🔔"}
        </button>

        {e2eStatus === "none" && (
          <button className="badge" onClick={handleRequest} disabled={busy} title="Request end-to-end encryption">
            {busy ? "…" : "🔒 Secure chat"}
          </button>
        )}
        {e2eStatus === "pending" && requestedByMe && (
          <span className="badge" style={{ opacity: 0.7 }} title="Waiting for the other side to respond">
            🔒 Pending…
          </span>
        )}
      </div>

      {iCanRespond && (
        <div style={styles.e2eBanner}>
          <div style={{ flex: 1, minWidth: 0 }}>
            🔒 <strong>{chat.e2e_requested_by}</strong> wants to start an end-to-end
            encrypted chat here.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" style={styles.acceptBtn} onClick={handleAccept} disabled={busy}>
              Accept
            </button>
            <button className="btn btn-secondary" onClick={handleReject} disabled={busy}>
              Reject
            </button>
          </div>
        </div>
      )}

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
  e2eBanner: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 12px",
    background: "var(--secure-bg)",
    borderBottom: "1px solid var(--border)",
    fontSize: 13,
    flexShrink: 0,
  },
  acceptBtn: {
    background: "var(--secure, #30b06a)",
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
