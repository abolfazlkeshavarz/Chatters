import { useCallback, useEffect, useState } from "react";
import { useChat } from "../hooks/useChat";
import { getChatKeys } from "../api/chats";
import { loadIdentity } from "../crypto/keystore";
import { safetyNumber, isSupported } from "../crypto/e2ee";
import MessageList from "../components/MessageList";
import Composer from "../components/Composer";
import ConnectionBanner from "../components/ConnectionBanner";

/**
 * End-to-end encrypted conversation, opened in place of the normal chat page
 * once encryption is switched on.
 *
 * Everything cryptographic happens in the browser: the server only ever sees
 * ciphertext plus one wrapped key per recipient, so neither the operator nor
 * the admin panel can read these messages.
 */
export default function SecureChat({ chatId, title, onBack }) {
  const me = localStorage.getItem("username");

  const [identity, setIdentity] = useState(null);
  const [recipients, setRecipients] = useState(null);
  const [missingKeys, setMissingKeys] = useState([]);
  const [replyTo, setReplyTo] = useState(null);
  const [setupError, setSetupError] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [showVerify, setShowVerify] = useState(false);
  const [ready, setReady] = useState(false);

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

      // Safety number only makes sense for a two-party conversation.
      const others = members.filter((m) => m.user_id !== me);
      if (others.length === 1) {
        setFingerprint(
          await safetyNumber(stored.publicKeyB64, others[0].public_key)
        );
      }
    } catch (err) {
      setSetupError(err.message || "Could not prepare secure chat");
    } finally {
      setReady(true);
    }
  }, [chatId, me]);

  useEffect(() => {
    setReady(false);
    setIdentity(null);
    setRecipients(null);
    loadCrypto();
  }, [loadCrypto]);

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

  const blocked = Boolean(setupError) || !identity || !recipients;

  return (
    <div className="pane">
      <div className="app-header" style={styles.header}>
        {onBack && (
          <button onClick={onBack} style={styles.back} aria-label="Back">
            ←
          </button>
        )}

        <div style={styles.titleBox}>
          <div style={styles.title}>
            <span aria-hidden="true">🔒 </span>
            {title}
          </div>
          <div style={styles.subtitle}>End-to-end encrypted</div>
        </div>

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

      {showVerify && (
        <div className="modal-overlay" onClick={() => setShowVerify(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalBody}>
              <h3 style={{ marginTop: 0 }}>Safety number</h3>
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
        <MessageList messages={messages} me={me} onReply={setReplyTo} secure />
      )}

      <Composer
        onSend={handleSend}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        disabled={blocked}
        // Attachments would be stored unencrypted on the server, which would
        // contradict the padlock on this page.
        allowAttachments={false}
        placeholder={blocked ? "Secure chat unavailable" : "پیام رمزنگاری‌شده"}
      />
    </div>
  );
}

const styles = {
  header: { borderBottom: "1px solid var(--secure)" },
  back: { fontSize: 24, minWidth: 40, padding: 8 },
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
