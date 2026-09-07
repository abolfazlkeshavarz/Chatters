import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";

import { useTheme } from "../theme";
import ImageViewer from "./ImageViewer";

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString("fa-IR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    try {
      return new Date(ts).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }
}

function isMedia(m) {
  return m.type === "media" || m.has_file || Boolean(m.filename);
}

function isImage(m) {
  if (m.mime_type) return m.mime_type.startsWith("image/");
  const name = m.filename || m.content || "";
  return /\.(jpe?g|png|gif|bmp|webp|avif)$/i.test(name);
}

function isSystem(m) {
  return m.type === "system" || m.is_system || (!m.from && !m.is_encrypted);
}

function countdownLabel(expiresAt, now) {
  const secs = Math.ceil((new Date(expiresAt).getTime() - now) / 1000);
  if (secs <= 0) return null;
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.ceil(secs / 60)}m`;
  if (secs < 86400) return `${Math.ceil(secs / 3600)}h`;
  return `${Math.ceil(secs / 86400)}d`;
}

const STATUS_LABEL = { sent: "Sent", delivered: "Delivered", seen: "Read" };

export default function MessageList({
  messages,
  me,
  onReply,
  onDelete,
  secure = false,
}) {
  const theme = useTheme();
  const listRef = useRef(null);
  const pinnedToBottom = useRef(true);

  const [heldId, setHeldId] = useState(null);
  const [preview, setPreview] = useState(null);

  // Ticks the self-destruct countdowns and hides a message the moment its
  // timer elapses, ahead of the server's sweep broadcast.
  const [now, setNow] = useState(() => Date.now());
  const hasTimers = messages.some((m) => m.expires_at);
  useEffect(() => {
    if (!hasTimers) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasTimers]);

  const visible = useMemo(
    () =>
      messages.filter(
        (m) => !(m.expires_at && new Date(m.expires_at).getTime() <= now)
      ),
    [messages, now]
  );

  const byId = useMemo(
    () => new Map(messages.map((m) => [m.id, m])),
    [messages]
  );

  function onScroll(e) {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    pinnedToBottom.current =
      contentSize.height - contentOffset.y - layoutMeasurement.height < 120;
  }

  function maybeScrollToEnd() {
    if (pinnedToBottom.current && listRef.current) {
      listRef.current.scrollToEnd({ animated: true });
    }
  }

  function outgoingBubble(status) {
    if (status === "seen") {
      return { backgroundColor: theme.success, color: "#fff", borderColor: "transparent" };
    }
    if (status === "delivered") {
      return {
        backgroundColor: theme.primary,
        color: theme.primaryContrast,
        borderColor: "transparent",
      };
    }
    return {
      backgroundColor: theme.bubbleSent,
      color: theme.bubbleSentText,
      borderColor: theme.bubbleSentBorder,
    };
  }

  function renderBody(message, textColor) {
    if (message.decryptError === "locked") {
      return (
        <Text style={[styles.systemNote, { color: textColor }]}>
          🔒 Unlock secure chat to read this message
        </Text>
      );
    }
    if (message.decryptError === "failed") {
      return (
        <Text style={[styles.systemNote, { color: textColor }]}>
          🔒 Cannot decrypt — this message was sent to a different key
        </Text>
      );
    }

    if (isMedia(message)) {
      const label = message.filename || message.content || "attachment";
      if (isImage(message)) {
        return (
          <Pressable onPress={() => setPreview(message)}>
            <Text style={[styles.mediaIcon]}>🖼️</Text>
            <Text style={[styles.mediaLabel, { color: textColor }]}>{label}</Text>
            <Text style={[styles.mediaHint, { color: textColor }]}>Tap to view</Text>
          </Pressable>
        );
      }
      return (
        <Pressable onPress={() => setPreview(message)}>
          <Text style={[styles.text, { color: textColor }]}>📎 {label}</Text>
        </Pressable>
      );
    }

    return (
      <Text style={[styles.text, { color: textColor }]}>{message.content}</Text>
    );
  }

  function renderItem({ item: m }) {
    if (isSystem(m)) {
      return (
        <View style={styles.systemRow}>
          <Text style={[styles.systemPill, { color: theme.subtext, backgroundColor: theme.bubbleIn }]}>
            {m.content}
          </Text>
        </View>
      );
    }

    const mine = m.from === me;
    const replied = m.reply_to ? byId.get(m.reply_to) : null;
    const canDeleteEveryone = mine || secure;
    const countdown = m.expires_at ? countdownLabel(m.expires_at, now) : null;
    const palette = mine
      ? outgoingBubble(m.status)
      : {
          backgroundColor: theme.bubbleIn,
          color: theme.bubbleInText,
          borderColor: "transparent",
        };

    return (
      <View style={[styles.row, { justifyContent: mine ? "flex-end" : "flex-start" }]}>
        <Pressable
          onLongPress={() => setHeldId(m.id)}
          delayLongPress={350}
          style={[
            styles.bubble,
            { backgroundColor: palette.backgroundColor, borderColor: palette.borderColor },
          ]}
        >
          {!mine && (
            <Text style={[styles.sender, { color: palette.color }]}>{m.from}</Text>
          )}

          {replied && (
            <View style={styles.replyPreview}>
              <Text style={[styles.replyName, { color: palette.color }]}>
                {replied.from}
              </Text>
              <Text numberOfLines={1} style={[styles.replyText, { color: palette.color }]}>
                {isMedia(replied)
                  ? `📎 ${replied.filename || replied.content}`
                  : replied.content}
              </Text>
            </View>
          )}

          {renderBody(m, palette.color)}

          <Text style={[styles.meta, { color: palette.color }]}>
            {secure ? "🔒 " : ""}
            {formatTime(m.created_at)}
            {countdown ? `  ·  🔥 ${countdown}` : ""}
            {mine ? `  ·  ${STATUS_LABEL[m.status] || STATUS_LABEL.sent}` : ""}
          </Text>

          {heldId === m.id && (
            <View style={styles.actions}>
              <Pressable
                onPress={() => {
                  onReply(m);
                  setHeldId(null);
                }}
              >
                <Text style={[styles.action, { color: palette.color }]}>↩ Reply</Text>
              </Pressable>
              {!isMedia(m) && !m.decryptError && (
                <Pressable
                  onPress={() => {
                    Clipboard.setStringAsync(m.content || "");
                    setHeldId(null);
                  }}
                >
                  <Text style={[styles.action, { color: palette.color }]}>📋 Copy</Text>
                </Pressable>
              )}
              {onDelete && (
                <Pressable
                  onPress={() => {
                    onDelete(m, "me");
                    setHeldId(null);
                  }}
                >
                  <Text style={[styles.action, { color: palette.color }]}>🗑 For me</Text>
                </Pressable>
              )}
              {onDelete && canDeleteEveryone && (
                <Pressable
                  onPress={() => {
                    onDelete(m, "everyone");
                    setHeldId(null);
                  }}
                >
                  <Text style={[styles.action, { color: palette.color }]}>🗑 For everyone</Text>
                </Pressable>
              )}
              <Pressable onPress={() => setHeldId(null)}>
                <Text style={[styles.action, { color: palette.color }]}>✕</Text>
              </Pressable>
            </View>
          )}
        </Pressable>
      </View>
    );
  }

  return (
    <>
      <ImageViewer message={preview} onClose={() => setPreview(null)} />
      <FlatList
        ref={listRef}
        data={visible}
        keyExtractor={(m) => String(m.id)}
        renderItem={renderItem}
        onScroll={onScroll}
        scrollEventThrottle={64}
        onContentSizeChange={maybeScrollToEnd}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: theme.subtext }]}>
            {secure ? "🔒 No messages yet in this secure chat" : "No messages yet"}
          </Text>
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: { padding: 8, gap: 6, flexGrow: 1 },
  empty: { textAlign: "center", marginTop: 40, fontSize: 14 },
  row: { flexDirection: "row" },
  systemRow: { alignItems: "center", marginVertical: 4 },
  systemPill: {
    fontSize: 12,
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 12,
    textAlign: "center",
    overflow: "hidden",
    maxWidth: "90%",
  },
  bubble: {
    maxWidth: "85%",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sender: { fontSize: 12, fontWeight: "700", marginBottom: 4, opacity: 0.85 },
  text: { fontSize: 15, lineHeight: 21 },
  systemNote: { fontSize: 13, fontStyle: "italic", opacity: 0.9 },
  meta: { fontSize: 11, marginTop: 4, opacity: 0.7, textAlign: "right" },
  replyPreview: {
    backgroundColor: "rgba(127,127,127,0.18)",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginBottom: 6,
  },
  replyName: { fontSize: 11, fontWeight: "700", opacity: 0.9 },
  replyText: { fontSize: 12, opacity: 0.85 },
  actions: { flexDirection: "row", gap: 14, marginTop: 8, flexWrap: "wrap" },
  action: { fontSize: 12, opacity: 0.9 },
  mediaIcon: { fontSize: 40 },
  mediaLabel: { fontSize: 13 },
  mediaHint: { fontSize: 11, opacity: 0.75 },
});
