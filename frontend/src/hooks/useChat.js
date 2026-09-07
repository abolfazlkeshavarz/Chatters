import { useCallback, useEffect, useRef, useState } from "react";
import { getMessages } from "../api/messages";
import { currentUser } from "../api/auth";
import { chatSocket } from "../services/websocket";
import { decryptMessage, encryptMessage } from "../crypto/e2ee";
import { uploadMedia, releaseMediaURL } from "../api/media";

// Delivery states, in the order a message passes through them.
const STATUS_ORDER = { sent: 0, delivered: 1, seen: 2 };

// Optimistic (not-yet-acknowledged) messages get an id from up here so they
// always sort after every real message — the server assigns real ids from a
// SERIAL sequence that will not reach this range in the life of the app.
const CLIENT_ID_BASE = 1e15;

/**
 * Delivery state only ever moves forwards. Status events can arrive out of
 * order — a reconnect sweep marking "delivered" may land just after the read
 * receipt for the same message — and without this guard a green bubble would
 * flip back to blue.
 */
export function advanceStatus(current, next) {
  const from = STATUS_ORDER[current] ?? 0;
  const to = STATUS_ORDER[next];
  if (to === undefined) return current;
  return to > from ? next : current;
}

/**
 * Total order for messages within a conversation.
 *
 * The server assigns `id` from a single sequence at the one point every message
 * is persisted, so it strictly reflects insertion order and is identical on
 * every device. Sorting on the client-parsed timestamp instead lost
 * sub-millisecond precision, so two messages sent in the same millisecond could
 * land in a different order on each device — which is why an encrypted
 * conversation could look reordered between phones. Compare by id; fall back to
 * the timestamp only for anything that somehow has no numeric id yet.
 */
export function compareMessages(a, b) {
  const ai = Number.isFinite(a.id) ? a.id : null;
  const bi = Number.isFinite(b.id) ? b.id : null;
  if (ai !== null && bi !== null) return ai - bi;
  const at = new Date(a.created_at).getTime() || 0;
  const bt = new Date(b.created_at).getTime() || 0;
  if (at !== bt) return at - bt;
  if (ai !== null) return -1;
  if (bi !== null) return 1;
  return 0;
}

/**
 * Drives one conversation: initial load, live updates, reconnect resync and
 * sending. Both the plain and the end-to-end encrypted chat pages use it.
 *
 * The resync-on-reconnect behaviour is the other half of the "no new messages
 * after switching apps" fix. Even with a socket that reconnects reliably,
 * anything sent during the gap was never delivered to this client, so on every
 * (re)connect we refetch and merge.
 *
 * @param {object}   options
 * @param {string}   options.chatId
 * @param {boolean}  options.encrypted    conversation is end-to-end encrypted
 * @param {CryptoKey} options.privateKey  our identity key, for decryption
 * @param {Array}    options.recipients   {user_id, public_key} for encryption
 */
export function useChat({ chatId, encrypted = false, privateKey = null, recipients = null }) {
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState(chatSocket.status);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Kept in refs so the socket subscription does not need re-creating (and
  // the chat does not flicker) every time a prop changes.
  const privateKeyRef = useRef(privateKey);
  const recipientsRef = useRef(recipients);
  const encryptedRef = useRef(encrypted);
  const chatIdRef = useRef(chatId);

  privateKeyRef.current = privateKey;
  recipientsRef.current = recipients;
  encryptedRef.current = encrypted;
  chatIdRef.current = chatId;

  // Media upload bookkeeping.
  const mediaCounter = useRef(0);
  // Filenames of uploads in flight: the server echoes a media message over the
  // socket too, and without this we would briefly show it twice — once as the
  // optimistic bubble, once as the echo.
  const pendingMediaNames = useRef(new Set());
  // Object URLs minted for local previews, revoked when the chat is left.
  const localURLs = useRef([]);

  /** Turn a wire message into something renderable, decrypting if needed. */
  const materialise = useCallback(async (msg) => {
    if (!msg.is_encrypted) return msg;

    const key = privateKeyRef.current;
    if (!key) {
      return { ...msg, content: "", decryptError: "locked" };
    }

    try {
      return { ...msg, content: await decryptMessage(msg, key), decrypted: true };
    } catch {
      // Most often: the message predates this device's key, or it was sent
      // before we published one.
      return { ...msg, content: "", decryptError: "failed" };
    }
  }, []);

  const mergeMessages = useCallback((incoming) => {
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) {
        // Server copies win: they carry the authoritative status/timestamp.
        byId.set(m.id, { ...byId.get(m.id), ...m });
      }
      return [...byId.values()].sort(compareMessages);
    });
  }, []);

  const dropMessages = useCallback((ids) => {
    const gone = new Set(ids);
    setMessages((prev) => {
      for (const m of prev) {
        if (!gone.has(m.id)) continue;
        releaseMediaURL(m.id);
        if (m._localURL) URL.revokeObjectURL(m._localURL);
      }
      return prev.filter((m) => !gone.has(m.id));
    });
  }, []);

  const load = useCallback(async () => {
    if (!chatId) return;
    try {
      const data = (await getMessages(chatId)) || [];
      const rendered = await Promise.all(data.map(materialise));
      mergeMessages(rendered);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load messages");
    } finally {
      setLoading(false);
    }
  }, [chatId, materialise, mergeMessages]);

  // Reset when switching conversations so the previous chat's messages never
  // flash up under the new title.
  useEffect(() => {
    setMessages([]);
    setLoading(true);
    load();
  }, [chatId, load]);

  // Revoke local preview URLs when leaving the conversation.
  useEffect(() => {
    const urls = localURLs.current;
    const pending = pendingMediaNames.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.length = 0;
      pending.clear();
    };
  }, [chatId]);

  useEffect(() => {
    chatSocket.start();

    const offMessage = chatSocket.onMessage(async (msg) => {
      if (msg.chat_id !== chatIdRef.current) return;

      if (msg.type === "status" || msg.type === "seen") {
        // "seen" is the pre-three-state event name; still accepted so a client
        // left open across a deploy keeps updating.
        const next = msg.type === "seen" ? "seen" : msg.status;
        const ids = new Set(msg.message_ids || []);
        setMessages((prev) =>
          prev.map((m) =>
            ids.has(m.id) ? { ...m, status: advanceStatus(m.status, next) } : m
          )
        );
        return;
      }

      // "delete for everyone" and the self-destruct sweep both arrive as this.
      if (msg.type === "deleted") {
        dropMessages(msg.ids || []);
        return;
      }

      if (msg.type === "message" || msg.type === "media") {
        // Suppress the socket echo of an attachment we are uploading right now;
        // sendMedia() owns that bubble until its HTTP response lands.
        const echoOfMyUpload =
          !msg.is_system &&
          (msg.type === "media" || msg.has_file) &&
          msg.from === currentUser() &&
          msg.filename &&
          pendingMediaNames.current.has(msg.filename);
        if (echoOfMyUpload) return;

        const rendered = await materialise(msg);
        if (msg.is_system) rendered.type = "system";
        mergeMessages([rendered]);

        // A message that lands while this chat is on screen has been read the
        // moment it arrives, so acknowledge it rather than leaving it stuck on
        // "delivered" until the user navigates away and back.
        if (
          !msg.is_system &&
          msg.from !== currentUser() &&
          document.visibilityState === "visible"
        ) {
          chatSocket.send({ type: "seen", chat_id: chatIdRef.current });
        }
      }
    });

    const offStatus = chatSocket.onStatus((s) => {
      if (s === "reconnected") {
        // Catch up on whatever arrived while the socket was down.
        load();
        chatSocket.send({ type: "seen", chat_id: chatIdRef.current });
        return;
      }
      setStatus(s);
    });

    return () => {
      offMessage();
      offStatus();
    };
  }, [load, materialise, mergeMessages, dropMessages]);

  // Mark as read whenever this chat is opened.
  useEffect(() => {
    if (chatId) chatSocket.send({ type: "seen", chat_id: chatId });
  }, [chatId]);

  // Returning to a chat that was already open counts as reading it. Without
  // this, messages that arrived while the app sat in the background would stay
  // "delivered" for the sender even though the recipient is now looking right
  // at them — the socket never dropped, so no reconnect resync fires either.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible" && chatIdRef.current) {
        chatSocket.send({ type: "seen", chat_id: chatIdRef.current });
      }
    }

    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const send = useCallback(
    async (text, replyTo) => {
      const body = text.trim();
      if (!body) return false;

      if (!encryptedRef.current) {
        return chatSocket.send({
          chat_id: chatIdRef.current,
          content: body,
          reply_to: replyTo || null,
        });
      }

      const people = recipientsRef.current;
      if (!people || people.length === 0) {
        setError("Cannot encrypt: no member keys are available.");
        return false;
      }

      try {
        const { ciphertext, iv, keys } = await encryptMessage(body, people);
        return chatSocket.send({
          chat_id: chatIdRef.current,
          content: ciphertext,
          reply_to: replyTo || null,
          is_encrypted: true,
          cipher_iv: iv,
          keys,
        });
      } catch (err) {
        setError(err.message || "Encryption failed");
        return false;
      }
    },
    []
  );

  /**
   * Send an attachment with an optimistic bubble: it appears immediately with a
   * local preview and a progress ring, tracks the upload percentage, then
   * settles onto the real server message id. A failure leaves the bubble in
   * place marked failed, so it can be retried without re-picking the file.
   */
  const sendMedia = useCallback(
    async (file, replyTo) => {
      if (!file) return false;
      // Attachments in a secure chat would be stored server-side in cleartext,
      // silently breaking the guarantee the padlock implies. The Composer hides
      // the control there; this is the backstop.
      if (encryptedRef.current) {
        setError("Attachments are disabled in secure chats.");
        return false;
      }

      const chat = chatIdRef.current;
      const tempId = CLIENT_ID_BASE + mediaCounter.current++;
      const mime = file.type || "application/octet-stream";
      const previewable = mime.startsWith("image/") || mime.startsWith("video/");
      const localURL = previewable ? URL.createObjectURL(file) : null;
      if (localURL) localURLs.current.push(localURL);

      pendingMediaNames.current.add(file.name);

      const optimistic = {
        id: tempId,
        from: currentUser(),
        type: "media",
        has_file: true,
        filename: file.name,
        mime_type: mime,
        content: file.name,
        created_at: new Date().toISOString(),
        status: "sent",
        reply_to: replyTo || null,
        pending: true,
        progress: 0,
        _localURL: localURL,
        _size: file.size,
        _file: file,
      };
      setMessages((prev) => [...prev, optimistic].sort(compareMessages));

      const { promise } = uploadMedia(chat, file, {
        onProgress: (p) =>
          setMessages((prev) =>
            prev.map((m) => (m.id === tempId ? { ...m, progress: p } : m))
          ),
      });

      try {
        const { message_id } = await promise;
        setMessages((prev) => {
          const withoutTemp = prev.filter((m) => m.id !== tempId);
          const already = withoutTemp.find((m) => m.id === message_id);
          if (already) {
            // The socket echo won the race after all; keep the local preview so
            // it does not re-download what we just uploaded.
            return withoutTemp
              .map((m) =>
                m.id === message_id
                  ? { ...m, _localURL: m._localURL || localURL }
                  : m
              )
              .sort(compareMessages);
          }
          return [
            ...withoutTemp,
            {
              ...optimistic,
              id: message_id,
              pending: false,
              failed: false,
              progress: 100,
              _file: undefined,
            },
          ].sort(compareMessages);
        });
        return true;
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId ? { ...m, pending: false, failed: true } : m
          )
        );
        setError(err.message || "Upload failed");
        return false;
      } finally {
        pendingMediaNames.current.delete(file.name);
      }
    },
    []
  );

  /** Re-run a failed upload from its optimistic bubble. */
  const retryMedia = useCallback(
    (message) => {
      if (!message?._file) return;
      setMessages((prev) => prev.filter((m) => m.id !== message.id));
      sendMedia(message._file, message.reply_to);
    },
    [sendMedia]
  );

  return {
    messages,
    status,
    loading,
    error,
    setError,
    send,
    sendMedia,
    retryMedia,
    reload: load,
  };
}
