import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { getMessages } from "../api/messages";
import { currentUser } from "../api/auth";
import { chatSocket } from "../services/websocket";
import { decryptMessage, encryptMessage } from "../crypto/e2ee";

const STATUS_ORDER = { sent: 0, delivered: 1, seen: 2 };

/**
 * Delivery state only ever moves forwards, so an out-of-order "delivered" that
 * lands after a "seen" for the same message does not flip a bubble back.
 */
export function advanceStatus(current, next) {
  const from = STATUS_ORDER[current] ?? 0;
  const to = STATUS_ORDER[next];
  if (to === undefined) return current;
  return to > from ? next : current;
}

/**
 * Total order for messages in a conversation. The server `id` is a single
 * sequence assigned at the one persistence point, so it is a total order every
 * device agrees on — unlike the client-parsed timestamp, which loses
 * sub-millisecond precision and made encrypted chats render in a different
 * order on each device. Compare by id; the timestamp is only a fallback for a
 * message that has no numeric id yet.
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

const isActive = () => AppState.currentState === "active";

/**
 * Drives one conversation: initial load, live updates, reconnect resync and
 * sending. Both the plain and the end-to-end encrypted screens use it.
 * Identical logic to the web hook; `document.visibilityState` is replaced with
 * React Native's AppState.
 */
export function useChat({ chatId, encrypted = false, privateKey = null, recipients = null }) {
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState(chatSocket.status);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const privateKeyRef = useRef(privateKey);
  const recipientsRef = useRef(recipients);
  const encryptedRef = useRef(encrypted);
  const chatIdRef = useRef(chatId);

  privateKeyRef.current = privateKey;
  recipientsRef.current = recipients;
  encryptedRef.current = encrypted;
  chatIdRef.current = chatId;

  const materialise = useCallback(async (msg) => {
    if (!msg.is_encrypted) return msg;

    const key = privateKeyRef.current;
    if (!key) return { ...msg, content: "", decryptError: "locked" };

    try {
      return { ...msg, content: await decryptMessage(msg, key), decrypted: true };
    } catch {
      return { ...msg, content: "", decryptError: "failed" };
    }
  }, []);

  const mergeMessages = useCallback((incoming) => {
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) {
        byId.set(m.id, { ...byId.get(m.id), ...m });
      }
      return [...byId.values()].sort(compareMessages);
    });
  }, []);

  const dropMessages = useCallback((ids) => {
    const gone = new Set(ids);
    setMessages((prev) => prev.filter((m) => !gone.has(m.id)));
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
        const next = msg.type === "seen" ? "seen" : msg.status;
        const ids = new Set(msg.message_ids || []);
        setMessages((prev) =>
          prev.map((m) =>
            ids.has(m.id) ? { ...m, status: advanceStatus(m.status, next) } : m
          )
        );
        return;
      }

      if (msg.type === "deleted") {
        dropMessages(msg.ids || []);
        return;
      }

      if (msg.type === "message" || msg.type === "media") {
        const rendered = await materialise(msg);
        if (msg.is_system) rendered.type = "system";
        mergeMessages([rendered]);

        if (!msg.is_system && msg.from !== currentUser() && isActive()) {
          chatSocket.send({ type: "seen", chat_id: chatIdRef.current });
        }
      }
    });

    const offStatus = chatSocket.onStatus((s) => {
      if (s === "reconnected") {
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

  useEffect(() => {
    if (chatId) chatSocket.send({ type: "seen", chat_id: chatId });
  }, [chatId]);

  // Returning to the foreground on a chat that is already open counts as
  // reading it.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && chatIdRef.current) {
        chatSocket.send({ type: "seen", chat_id: chatIdRef.current });
      }
    });
    return () => sub.remove();
  }, []);

  const send = useCallback(async (text, replyTo) => {
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
  }, []);

  return { messages, status, loading, error, setError, send, reload: load };
}
