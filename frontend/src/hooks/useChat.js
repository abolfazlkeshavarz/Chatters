import { useCallback, useEffect, useRef, useState } from "react";
import { getMessages } from "../api/messages";
import { currentUser } from "../api/auth";
import { chatSocket } from "../services/websocket";
import { decryptMessage, encryptMessage } from "../crypto/e2ee";

// Delivery states, in the order a message passes through them.
const STATUS_ORDER = { sent: 0, delivered: 1, seen: 2 };

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
      return [...byId.values()].sort(
        (a, b) =>
          new Date(a.created_at) - new Date(b.created_at) || a.id - b.id
      );
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

      if (msg.type === "message" || msg.type === "media") {
        mergeMessages([await materialise(msg)]);

        // A message that lands while this chat is on screen has been read the
        // moment it arrives, so acknowledge it rather than leaving it stuck on
        // "delivered" until the user navigates away and back.
        if (msg.from !== currentUser() && document.visibilityState === "visible") {
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
  }, [load, materialise, mergeMessages]);

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

  return { messages, status, loading, error, setError, send, reload: load };
}
