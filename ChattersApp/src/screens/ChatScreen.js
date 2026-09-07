import { useCallback, useEffect, useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";

import Screen from "../components/Screen";
import Avatar from "../components/Avatar";
import Composer from "../components/Composer";
import MessageList from "../components/MessageList";
import ConnectionBanner from "../components/ConnectionBanner";
import { chatTitle } from "./ChatListScreen";
import { useChat } from "../hooks/useChat";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../theme";
import {
  getChats,
  getChatKeys,
  createSecretChat,
  acceptE2E,
  rejectE2E,
  setChatMute,
  setSelfDestruct,
  deleteChat,
} from "../api/chats";
import { deleteMessage } from "../api/messages";
import { uploadMedia } from "../api/media";
import { chatSocket } from "../services/websocket";
import { loadIdentity } from "../crypto/keystore";
import { safetyNumber, isSupported } from "../crypto/e2ee";

const TIMER_OPTIONS = [
  { label: "Off", seconds: 0 },
  { label: "5 seconds", seconds: 5 },
  { label: "30 seconds", seconds: 30 },
  { label: "1 minute", seconds: 60 },
  { label: "1 hour", seconds: 3600 },
  { label: "1 day", seconds: 86400 },
  { label: "1 week", seconds: 604800 },
];
const timerLabel = (s) =>
  TIMER_OPTIONS.find((o) => o.seconds === s)?.label || `${s}s`;

export default function ChatScreen({ route, navigation }) {
  const theme = useTheme();
  const { user: me } = useAuth();

  const [chat, setChat] = useState(route.params?.chat || null);
  const chatId = chat?.id || route.params?.chatId;

  useEffect(() => {
    if (chat || !route.params?.chatId) return;
    getChats()
      .then((list) => {
        const found = (list || []).find((c) => c.id === route.params.chatId);
        if (found) setChat(found);
      })
      .catch(() => {});
  }, [chat, route.params?.chatId]);

  const patchChat = useCallback((patch) => {
    setChat((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const isSecret = Boolean(chat?.is_secret);
  const active = Boolean(chat?.e2e_enabled);
  const pending = isSecret && !active && chat?.e2e_status === "pending";
  // Encrypted covers secret chats and any legacy in-place encrypted chat.
  const secure = active;
  const requestedByMe = chat?.e2e_requested_by === me;
  const title = chat ? chatTitle(chat, me) : "";

  const [selfDestructSeconds, setSelfDestructSeconds] = useState(
    chat?.self_destruct_seconds || 0
  );
  useEffect(() => {
    setSelfDestructSeconds(chat?.self_destruct_seconds || 0);
  }, [chat?.self_destruct_seconds]);

  // React to timer changes / chat deletion pushed while this screen is open.
  useEffect(() => {
    if (!chatId) return undefined;
    return chatSocket.onMessage((msg) => {
      if (msg.chat_id !== chatId) return;
      if (msg.type === "timer") {
        setSelfDestructSeconds(msg.seconds || 0);
        patchChat({ self_destruct_seconds: msg.seconds || 0 });
      } else if (msg.type === "chat_deleted") {
        navigation.goBack();
      } else if (msg.type === "e2e_accepted") {
        patchChat({ e2e_status: "accepted", e2e_enabled: true });
      } else if (msg.type === "e2e_rejected") {
        navigation.goBack();
      }
    });
  }, [chatId, patchChat, navigation]);

  /* -------------------------------------------------- secure-mode crypto */

  const [identity, setIdentity] = useState(null);
  const [recipients, setRecipients] = useState(null);
  const [missingKeys, setMissingKeys] = useState([]);
  const [fingerprint, setFingerprint] = useState("");
  const [showVerify, setShowVerify] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [cryptoReady, setCryptoReady] = useState(!secure);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!secure || !chatId) {
      setCryptoReady(true);
      return undefined;
    }
    let cancelled = false;
    setCryptoReady(false);
    setSetupError("");
    (async () => {
      if (!isSupported()) {
        if (!cancelled) {
          setSetupError("This device cannot do end-to-end encryption.");
          setCryptoReady(true);
        }
        return;
      }
      try {
        const stored = await loadIdentity(me);
        if (!stored) {
          if (!cancelled) {
            setSetupError(
              "Your encryption key is not on this device. Sign out and back in to unlock secure chat."
            );
            setCryptoReady(true);
          }
          return;
        }
        const { members, without_keys: without } = await getChatKeys(chatId);
        if (cancelled) return;
        setIdentity(stored);
        setRecipients(members);
        setMissingKeys(without || []);
        const others = members.filter((m) => m.user_id !== me);
        if (others.length === 1) {
          setFingerprint(await safetyNumber(stored.publicKeyB64, others[0].public_key));
        }
      } catch (err) {
        if (!cancelled) setSetupError(err.message || "Could not prepare secure chat");
      } finally {
        if (!cancelled) setCryptoReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [secure, chatId, me]);

  /* ---------------------------------------------------------- messaging */

  const [replyTo, setReplyTo] = useState(null);
  const [notice, setNotice] = useState("");

  const { messages, status, error, setError, send } = useChat({
    chatId,
    encrypted: secure,
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
      setError(err.message || "Could not delete the message");
    }
  }

  function handleAttach() {
    Alert.alert("Attach", undefined, [
      {
        text: "Photo",
        onPress: async () => {
          const res = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            quality: 0.85,
          });
          if (!res.canceled) uploadPicked(res.assets[0]);
        },
      },
      {
        text: "File",
        onPress: async () => {
          const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
          if (!res.canceled) uploadPicked(res.assets[0]);
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  async function uploadPicked(asset) {
    try {
      await uploadMedia(chatId, {
        uri: asset.uri,
        name: asset.fileName || asset.name,
        mimeType: asset.mimeType,
      });
    } catch (err) {
      setError(err.message || "آپلود فایل ناموفق بود");
    }
  }

  function chooseTimer() {
    Alert.alert(
      "Self-destruct timer",
      "New messages are deleted this long after they are sent, on every device.",
      [
        ...TIMER_OPTIONS.map((o) => ({
          text: (o.seconds === selfDestructSeconds ? "✓ " : "") + o.label,
          onPress: () => changeTimer(o.seconds),
        })),
        { text: "Cancel", style: "cancel" },
      ]
    );
  }

  async function changeTimer(seconds) {
    const prev = selfDestructSeconds;
    setSelfDestructSeconds(seconds);
    try {
      await setSelfDestruct(chatId, seconds);
      patchChat({ self_destruct_seconds: seconds });
    } catch (err) {
      setSelfDestructSeconds(prev);
      setError(err.message || "Could not change the timer");
    }
  }

  function startSecret() {
    const other = (chat?.members || []).find((m) => m !== me);
    if (!other) return;
    Alert.alert(
      "Start a secret chat?",
      "It opens as a separate, end-to-end encrypted conversation once they accept. This chat is unchanged.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Start",
          onPress: async () => {
            setBusy(true);
            try {
              const { chat_id: secretId } = await createSecretChat(other);
              setBusy(false);
              navigation.replace("Chat", { chatId: secretId });
            } catch (err) {
              setBusy(false);
              setError(err.message || "Could not start the secret chat");
            }
          },
        },
      ]
    );
  }

  function confirmDeleteChat() {
    const scope = chat?.is_secret ? "everyone" : "me";
    Alert.alert(
      chat?.is_group ? "Leave group?" : "Delete chat?",
      chat?.is_secret
        ? "This deletes the secret chat for both of you. Cannot be undone."
        : chat?.is_group
        ? "You will stop receiving its messages."
        : "Removes it from your list. The other person keeps their copy.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: chat?.is_group ? "Leave" : "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteChat(chatId, scope);
              navigation.goBack();
            } catch (err) {
              setError(err.message || "Could not delete the chat");
            }
          },
        },
      ]
    );
  }

  async function toggleMute() {
    const next = !chat?.muted;
    patchChat({ muted: next });
    try {
      await setChatMute(chatId, next);
    } catch {
      patchChat({ muted: !next });
    }
  }

  if (!chat) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={{ color: theme.subtext }}>Loading conversation…</Text>
        </View>
      </Screen>
    );
  }

  /* ------------------------------------------------------------- pending */

  if (pending) {
    return (
      <Screen edges={["top", "bottom"]}>
        <View style={[styles.header, { borderBottomColor: theme.secure }]}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
            <Text style={[styles.back, { color: theme.text }]}>‹</Text>
          </Pressable>
          {!chat.is_group && <Avatar userId={title} size={32} />}
          <View style={styles.flex}>
            <Text numberOfLines={1} style={[styles.title, { color: theme.text }]}>
              🔒 {title}
            </Text>
            <Text style={[styles.subtitle, { color: theme.secure }]}>
              Secret chat · pending
            </Text>
          </View>
        </View>
        <ConnectionBanner status={status} />
        <View style={styles.center}>
          {requestedByMe ? (
            <Text style={{ color: theme.subtext, textAlign: "center" }}>
              Waiting for {title} to accept this secret chat. You can send
              messages once they do.
            </Text>
          ) : (
            <View style={{ maxWidth: 320, gap: 10 }}>
              <Text style={{ color: theme.text, textAlign: "center" }}>
                {chat.e2e_requested_by} wants to start an end-to-end encrypted
                secret chat with you.
              </Text>
              {error ? (
                <Text style={{ color: theme.danger, textAlign: "center" }}>{error}</Text>
              ) : null}
              <View style={{ flexDirection: "row", gap: 10, justifyContent: "center" }}>
                <Pressable
                  style={[styles.miniBtn, { backgroundColor: theme.secure }]}
                  disabled={busy}
                  onPress={async () => {
                    setBusy(true);
                    try {
                      await acceptE2E(chatId);
                      patchChat({ e2e_status: "accepted", e2e_enabled: true });
                    } catch (err) {
                      setError(err.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Text style={styles.miniBtnText}>Accept</Text>
                </Pressable>
                <Pressable
                  style={[styles.miniBtn, { backgroundColor: theme.border }]}
                  disabled={busy}
                  onPress={async () => {
                    setBusy(true);
                    try {
                      await rejectE2E(chatId);
                      navigation.goBack();
                    } catch (err) {
                      setError(err.message);
                      setBusy(false);
                    }
                  }}
                >
                  <Text style={[styles.miniBtnText, { color: theme.text }]}>Reject</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </Screen>
    );
  }

  /* -------------------------------------------------------------- active */

  const blocked = secure && (Boolean(setupError) || !identity || !recipients);

  return (
    <Screen edges={["top", "bottom"]} keyboardAvoiding>
      <View
        style={[styles.header, { borderBottomColor: secure ? theme.secure : theme.border }]}
      >
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Text style={[styles.back, { color: theme.text }]}>‹</Text>
        </Pressable>
        {!chat.is_group && <Avatar userId={title} size={32} />}
        <View style={styles.flex}>
          <Text numberOfLines={1} style={[styles.title, { color: theme.text }]}>
            {secure ? "🔒 " : ""}
            {title}
          </Text>
          <Text style={[styles.subtitle, { color: secure ? theme.secure : theme.subtext }]}>
            {secure
              ? `End-to-end encrypted${
                  selfDestructSeconds > 0 ? ` · 🔥 ${timerLabel(selfDestructSeconds)}` : ""
                }`
              : "Not encrypted"}
          </Text>
        </View>

        {isSecret && (
          <Pressable onPress={chooseTimer} hitSlop={8}>
            <Text style={styles.headerIcon}>⏱</Text>
          </Pressable>
        )}
        <Pressable onPress={toggleMute} hitSlop={8}>
          <Text style={styles.headerIcon}>{chat.muted ? "🔕" : "🔔"}</Text>
        </Pressable>
        <Pressable onPress={confirmDeleteChat} hitSlop={8}>
          <Text style={styles.headerIcon}>🗑</Text>
        </Pressable>
        {secure && fingerprint ? (
          <Pressable onPress={() => setShowVerify(true)} hitSlop={8}>
            <Text style={[styles.verify, { color: theme.secure }]}>Verify</Text>
          </Pressable>
        ) : !secure && !chat.is_group ? (
          <Pressable onPress={startSecret} hitSlop={8} disabled={busy}>
            <Text style={[styles.verify, { color: theme.primary }]}>🔒</Text>
          </Pressable>
        ) : null}
      </View>

      <ConnectionBanner status={status} />

      {error || notice || setupError ? (
        <Pressable
          onPress={() => {
            setError("");
            setNotice("");
          }}
          style={[styles.notice, { backgroundColor: setupError ? theme.danger : theme.unreadBg }]}
        >
          <Text style={{ color: setupError ? "#fff" : theme.text, fontSize: 13 }}>
            {setupError || error || notice}
          </Text>
        </Pressable>
      ) : null}

      {secure && missingKeys.length > 0 && (
        <View style={[styles.notice, { backgroundColor: theme.warnBg }]}>
          <Text style={{ color: theme.warnText, fontSize: 13 }}>
            No encryption key yet for: {missingKeys.join(", ")}. They must sign in once.
          </Text>
        </View>
      )}

      {secure && !cryptoReady ? (
        <View style={styles.center}>
          <Text style={{ color: theme.subtext }}>Unlocking secure chat…</Text>
        </View>
      ) : (
        <MessageList
          messages={messages}
          me={me}
          onReply={setReplyTo}
          onDelete={handleDelete}
          secure={secure}
        />
      )}

      <Composer
        onSend={handleSend}
        onAttach={handleAttach}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        disabled={blocked}
        allowAttachments={!secure}
        placeholder={
          blocked ? "Secure chat unavailable" : secure ? "پیام رمزنگاری‌شده" : "پیام"
        }
      />

      <Modal
        transparent
        visible={showVerify}
        animationType="fade"
        onRequestClose={() => setShowVerify(false)}
      >
        <Pressable
          style={[styles.overlay, { backgroundColor: theme.overlay }]}
          onPress={() => setShowVerify(false)}
        >
          <View style={[styles.verifyCard, { backgroundColor: theme.card }]}>
            <Text style={[styles.title, { color: theme.text }]}>Safety number</Text>
            <Text style={{ color: theme.subtext, fontSize: 13, marginVertical: 8 }}>
              Compare this with the other person over a channel you already trust.
              If it matches on both devices, nobody is intercepting this chat.
            </Text>
            <Text style={[styles.fingerprint, { color: theme.text, backgroundColor: theme.bg }]}>
              {fingerprint}
            </Text>
            <Pressable
              style={[
                styles.miniBtn,
                { backgroundColor: theme.primary, alignItems: "center", marginTop: 12 },
              ]}
              onPress={() => setShowVerify(false)}
            >
              <Text style={styles.miniBtnText}>Close</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { fontSize: 30, width: 22 },
  title: { fontSize: 16, fontWeight: "600" },
  subtitle: { fontSize: 12, marginTop: 1 },
  headerIcon: { fontSize: 18 },
  verify: { fontSize: 13, fontWeight: "600" },
  miniBtn: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  miniBtnText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  notice: { paddingHorizontal: 12, paddingVertical: 8 },
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  verifyCard: { width: "100%", maxWidth: 360, borderRadius: 16, padding: 20 },
  fingerprint: {
    fontFamily: "monospace",
    fontSize: 18,
    letterSpacing: 1,
    lineHeight: 30,
    textAlign: "center",
    borderRadius: 12,
    padding: 14,
  },
});
