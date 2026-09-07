import { useCallback, useEffect, useState } from "react";
import { useChat } from "../hooks/useChat";
import {
  getChatKeys,
  setChatMute,
  acceptE2E,
  rejectE2E,
  setSelfDestruct,
} from "../api/chats";
import { deleteMessage } from "../api/messages";
import { chatSocket } from "../services/websocket";
import Avatar from "../components/Avatar";
import { loadIdentity } from "../crypto/keystore";
import { safetyNumber, isSupported } from "../crypto/e2ee";
import MessageList from "../components/MessageList";
import Composer from "../components/Composer";
import ConnectionBanner from "../components/ConnectionBanner";

// The self-destruct menu; must match the server's allowlist.
const TIMER_OPTIONS = [
  { label: "Off", seconds: 0 },
  { label: "5 seconds", seconds: 5 },
  { label: "30 seconds", seconds: 30 },
  { label: "1 minute", seconds: 60 },
  { label: "1 hour", seconds: 3600 },
  { label: "1 day", seconds: 86400 },
  { label: "1 week", seconds: 604800 },
];

function timerLabel(seconds) {
  return TIMER_OPTIONS.find((o) => o.seconds === seconds)?.label || `${seconds}s`;
}

/**
 * A Telegram-style secret chat: its own 1:1 conversation, encrypted end to end.
 * It has two phases —
 *
 *   pending   the other person has not accepted yet; no messages can be sent
 *   active    e2e_enabled; everything cryptographic happens in the browser, so
 *             the server only ever sees ciphertext plus one wrapped key per
 *             recipient
 *
 * Either member can set a self-destruct timer that deletes each message a fixed
 * time after it is sent.
 */
export default function SecureChat({ chatId, title, chat, onBack, onChatPatch, onSecured }) {
  const me = localStorage.getItem("username");

  const pending = !chat?.e2e_enabled && chat?.e2e_status === "pending";
  const requestedByMe = chat?.e2e_requested_by === me;

  const [identity, setIdentity] = useState(null);
  const [recipients, setRecipients] = useState(null);
  const [missingKeys, setMissingKeys] = useState([]);
  const [replyTo, setReplyTo] = useState(null);
  const [setupError, setSetupError] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [showVerify, setShowVerify] = useState(false);
  const [showTimer, setShowTimer] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selfDestruct, setSelfDestructSeconds] = useState(
    chat?.self_destruct_seconds || 0
  );

  useEffect(() => {
    setSelfDestructSeconds(chat?.self_destruct_seconds || 0);
  }, [chat?.self_destruct_seconds]);

  // React to the other side changing the timer while this chat is open.
  useEffect(() => {
    return chatSocket.onMessage((msg) => {
      if (msg.chat_id !== chatId) return;
      if (msg.type === "timer") {
        setSelfDestructSeconds(msg.seconds || 0);
        onChatPatch?.({ self_destruct_seconds: msg.seconds || 0 });
      }
    });
  }, [chatId, onChatPatch]);

  const loadCrypto = useCallback(async () => {
    if (!isSupported()) {
      setSetupError(
        "This browser cannot do end-to-end encryption. It requires a modern browser served over HTTPS."
      );
      setReady(true);
      return;
    }

    try {
      const stored = await loadIdentity(me);
      if (!stored) {
        setSetupError(
          "Your encryption key is not available on this device. Sign out and sign back in to unlock secure chat."
        );
        setReady(true);
        return;
      }
      setIdentity(stored);

      const { members, without_keys: without } = await getChatKeys(chatId);
      setRecipients(members);
      setMissingKeys(without || []);

      const others = members.filter((m) => m.user_id !== me);
      if (others.length === 1) {
        setFingerprint(
          await safetyNumber(stored.publicKeyB64, others[0].public_key)
        );
      }
    } catch (err) {
      setSetupError(err.message || "آماده‌سازی گفتگوی محرمانه ناموفق بود");
    } finally {
      setReady(true);
    }
  }, [chatId, me]);

  useEffect(() => {
    if (pending) {
      setReady(true);
      return;
    }
    setReady(false);
    setIdentity(null);
    setRecipients(null);
    loadCrypto();
  }, [loadCrypto, pending]);

  const { messages, status, error, setError, send } = useChat({
    chatId,
    encrypted: true,
    privateKey: identity?.privateKey || null,
    recipients,
  });

  async function handleSend(text) {
    const ok = await send(text, replyTo?.id);
    if (ok) setReplyTo(null);
    return ok;
  }

  async function handleDelete(message, scope) {
    try {
      await deleteMessage(message.id, scope);
    } catch (err) {
      setError(err.message || "حذف پیام ناموفق بود");
    }
  }

  async function changeTimer(seconds) {
    setShowTimer(false);
    const prev = selfDestruct;
    setSelfDestructSeconds(seconds);
    try {
      await setSelfDestruct(chatId, seconds);
      onChatPatch?.({ self_destruct_seconds: seconds });
    } catch (err) {
      setSelfDestructSeconds(prev);
      setError(err.message || "تغییر زمان‌سنج ناموفق بود");
    }
  }

  async function handleAccept() {
    setBusy(true);
    try {
      await acceptE2E(chatId);
      onChatPatch?.({ e2e_status: "accepted", e2e_enabled: true });
      onSecured?.();
    } catch (err) {
      setError(err.message || "پذیرش ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    setBusy(true);
    try {
      await rejectE2E(chatId);
      onBack?.();
    } catch (err) {
      setError(err.message || "رد کردن ناموفق بود");
      setBusy(false);
    }
  }

  /* ---------------------------------------------------------------- pending */

  if (pending) {
    return (
      <div className="pane">
        <div className="app-header" style={styles.header}>
          {onBack && (
            <button onClick={onBack} style={styles.back} aria-label="بازگشت">
              ←
            </button>
          )}
          {!chat?.is_group && <Avatar userId={title} size={32} />}
          <div style={styles.titleBox}>
            <div style={styles.title}>
              <span aria-hidden="true">🔒 </span>
              {title}
            </div>
            <div style={styles.subtitle}>گفتگوی محرمانه · در انتظار</div>
          </div>
        </div>

        <ConnectionBanner status={status} />

        <div style={styles.center} className="muted">
          {requestedByMe ? (
            <p>
              Waiting for <strong>{title}</strong> to accept this secret chat.
              You will be able to send messages once they do.
            </p>
          ) : (
            <div style={{ maxWidth: 360, textAlign: "center" }}>
              <p>
                <strong>{chat?.e2e_requested_by}</strong> wants to start an
                end-to-end encrypted secret chat with you.
              </p>
              <p style={{ fontSize: 13 }}>
                New messages will be readable only on your and their device —
                not by the server or an administrator.
              </p>
              {error && <div className="error-text">{error}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
                <button className="btn" onClick={handleAccept} disabled={busy}>
                  Accept
                </button>
                <button className="btn btn-secondary" onClick={handleReject} disabled={busy}>
                  Reject
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ----------------------------------------------------------------- active */

  const blocked = Boolean(setupError) || !identity || !recipients;

  return (
    <div className="pane">
      <div className="app-header" style={styles.header}>
        {onBack && (
          <button onClick={onBack} style={styles.back} aria-label="بازگشت">
            ←
          </button>
        )}

        {!chat?.is_group && <Avatar userId={title} size={32} />}

        <div style={styles.titleBox}>
          <div style={styles.title}>
            <span aria-hidden="true">🔒 </span>
            {title}
          </div>
          <div style={styles.subtitle}>
            End-to-end encrypted
            {selfDestruct > 0 && ` · 🔥 ${timerLabel(selfDestruct)}`}
          </div>
        </div>

        {chat?.is_secret && (
          <button
            onClick={() => setShowTimer(true)}
            title="زمان‌سنج خودتخریبی"
            style={styles.muteBtn}
          >
            ⏱
          </button>
        )}

        <button
          onClick={async () => {
            const next = !chat?.muted;
            onChatPatch?.({ muted: next });
            try {
              await setChatMute(chatId, next);
            } catch {
              onChatPatch?.({ muted: !next });
            }
          }}
          title={chat?.muted ? "فعال کردن اعلان‌ها" : "بی‌صدا کردن اعلان‌ها"}
          style={styles.muteBtn}
        >
          {chat?.muted ? "🔕" : "🔔"}
        </button>

        {fingerprint && (
          <button
            className="badge badge-secure"
            onClick={() => setShowVerify(true)}
          >
            Verify
          </button>
        )}
      </div>

      <ConnectionBanner status={status} />

      {showTimer && (
        <div className="modal-overlay" onClick={() => setShowTimer(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalBody}>
              <h3 style={{ marginTop: 0 }}>زمان‌سنج خودتخریبی</h3>
              <p className="muted">
                New messages in this chat are deleted this long after they are
                sent, on every device. Applies to messages sent from now on.
              </p>
              <div className="stack" style={{ gap: 6 }}>
                {TIMER_OPTIONS.map((o) => (
                  <button
                    key={o.seconds}
                    className={`btn ${o.seconds === selfDestruct ? "" : "btn-secondary"}`}
                    style={{ justifyContent: "flex-start" }}
                    onClick={() => changeTimer(o.seconds)}
                  >
                    {o.seconds === selfDestruct ? "✓ " : ""}
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {showVerify && (
        <div className="modal-overlay" onClick={() => setShowVerify(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalBody}>
              <h3 style={{ marginTop: 0 }}>شماره امنیتی</h3>
              <p className="muted">
                Compare this number with the other person over a channel you
                already trust — in person, or a phone call. If it matches on
                both devices, nobody is intercepting this conversation.
              </p>
              <div style={styles.fingerprint}>{fingerprint}</div>
              <button
                className="btn btn-block"
                onClick={() => setShowVerify(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {setupError && <div style={styles.blockingError}>{setupError}</div>}

      {!setupError && missingKeys.length > 0 && (
        <div style={styles.warn}>
          These members have no encryption key yet and will not be able to read
          new messages: <strong>{missingKeys.join(", ")}</strong>. They need to
          sign in once.
        </div>
      )}

      {error && (
        <div style={styles.warn} onClick={() => setError("")}>
          {error}
        </div>
      )}

      {!ready ? (
        <div style={styles.center} className="muted">
          Unlocking secure chat…
        </div>
      ) : (
        <MessageList
          messages={messages}
          me={me}
          onReply={setReplyTo}
          onDelete={handleDelete}
          secure
        />
      )}

      <Composer
        onSend={handleSend}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        disabled={blocked}
        allowAttachments={false}
        placeholder={blocked ? "گفتگوی محرمانه در دسترس نیست" : "پیام رمزنگاری‌شده"}
      />
    </div>
  );
}

const styles = {
  header: { borderBottom: "1px solid var(--secure)" },
  back: { fontSize: 24, minWidth: 40, padding: 8 },
  muteBtn: {
    border: "none",
    background: "none",
    fontSize: 18,
    padding: 8,
    cursor: "pointer",
    lineHeight: 1,
  },
  titleBox: { flex: 1, minWidth: 0 },
  title: {
    fontSize: 16,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  subtitle: { fontSize: 12, color: "var(--secure)", fontWeight: 500 },
  warn: {
    padding: "8px 12px",
    background: "#fff4d6",
    color: "#5c4400",
    fontSize: 13,
    flexShrink: 0,
  },
  blockingError: {
    padding: "12px",
    background: "var(--danger)",
    color: "#fff",
    fontSize: 13,
    flexShrink: 0,
  },
  center: { flex: 1, display: "grid", placeItems: "center", padding: 24 },
  modalBody: { padding: 20 },
  fingerprint: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 18,
    letterSpacing: "0.06em",
    lineHeight: 1.8,
    textAlign: "center",
    background: "var(--bg)",
    borderRadius: 12,
    padding: 16,
    margin: "16px 0",
    wordBreak: "break-word",
  },
};
