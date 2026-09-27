import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function outgoingBubble(theme, status) {
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

const STATUS_LABEL = { sent: "Sent", delivered: "Delivered", seen: "Read" };

/**
 * Ticks its own countdown independently of every other row, and reports back
 * once, the moment it hits zero. Keeping this local — rather than one clock
 * in the parent driving every row's re-render every second — is what keeps a
 * self-destructing chat from redrawing the whole visible list every tick.
 */
function useCountdown(expiresAt, onExpire) {
  const [label, setLabel] = useState(() =>
    expiresAt ? countdownLabel(expiresAt, Date.now()) : null
  );
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (!expiresAt) return undefined;
    const tick = () => {
      const next = countdownLabel(expiresAt, Date.now());
      setLabel(next);
      if (!next) onExpireRef.current();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return label;
}

/**
 * One row. Memoized so that opening another message's action menu, or a
 * neighbour's self-destruct timer ticking, never re-renders bubbles whose own
 * props did not change — the default behaviour would otherwise redraw every
 * visible row on any of those, which is what made scrolling and long-pressing
 * feel heavy compared to a native chat app.
 */
const Bubble = memo(function Bubble({
  message: m,
  mine,
  me,
  secure,
  held,
  theme,
  getReplied,
  onHold,
  onUnhold,
  onReply,
  onDelete,
  onPreview,
  onExpire,
}) {
  const countdown = useCountdown(m.expires_at, onExpire);

  if (isSystem(m)) {
    return (
      <View style={styles.systemRow}>
        <Text
          style={[
            styles.systemPill,
            { color: theme.subtext, backgroundColor: theme.bubbleIn },
          ]}
        >
          {m.content}
        </Text>
      </View>
    );
  }

  const replied = m.reply_to ? getReplied(m.reply_to) : null;
  const canDeleteEveryone = mine || secure;
  const palette = mine
    ? outgoingBubble(theme, m.status)
    : { backgroundColor: theme.bubbleIn, color: theme.bubbleInText, borderColor: "transparent" };

  function renderBody() {
    if (m.decryptError === "locked") {
      return (
        <Text style={[styles.systemNote, { color: palette.color }]}>
          🔒 Unlock secure chat to read this message
        </Text>
      );
    }
    if (m.decryptError === "failed") {
      return (
        <Text style={[styles.systemNote, { color: palette.color }]}>
          🔒 Cannot decrypt — this message was sent to a different key
        </Text>
      );
    }

    if (isMedia(m)) {
      const label = m.filename || m.content || "attachment";
      if (isImage(m)) {
        return (
          <Pressable onPress={() => onPreview(m)}>
            <Text style={styles.mediaIcon}>🖼️</Text>
            <Text style={[styles.mediaLabel, { color: palette.color }]}>{label}</Text>
            <Text style={[styles.mediaHint, { color: palette.color }]}>Tap to view</Text>
          </Pressable>
        );
      }
      return (
        <Pressable onPress={() => onPreview(m)}>
          <Text style={[styles.text, { color: palette.color }]}>📎 {label}</Text>
        </Pressable>
      );
    }

    return <Text style={[styles.text, { color: palette.color }]}>{m.content}</Text>;
  }

  return (
    <View style={[styles.row, { justifyContent: mine ? "flex-end" : "flex-start" }]}>
      <Pressable
        onLongPress={() => onHold(m.id)}
        delayLongPress={350}
        style={[
          styles.bubble,
          { backgroundColor: palette.backgroundColor, borderColor: palette.borderColor },
        ]}
      >
        {!mine && <Text style={[styles.sender, { color: palette.color }]}>{m.from}</Text>}

        {replied && (
          <View style={styles.replyPreview}>
            <Text style={[styles.replyName, { color: palette.color }]}>{replied.from}</Text>
            <Text numberOfLines={1} style={[styles.replyText, { color: palette.color }]}>
              {isMedia(replied) ? `📎 ${replied.filename || replied.content}` : replied.content}
            </Text>
          </View>
        )}

        {renderBody()}

        <Text style={[styles.meta, { color: palette.color }]}>
          {secure ? "🔒 " : ""}
          {formatTime(m.created_at)}
          {countdown ? `  ·  🔥 ${countdown}` : ""}
          {mine ? `  ·  ${STATUS_LABEL[m.status] || STATUS_LABEL.sent}` : ""}
        </Text>

        {held && (
          <View style={styles.actions}>
            <Pressable
              onPress={() => {
                onReply(m);
                onUnhold();
              }}
            >
              <Text style={[styles.action, { color: palette.color }]}>↩ Reply</Text>
            </Pressable>
            {!isMedia(m) && !m.decryptError && (
              <Pressable
                onPress={() => {
                  Clipboard.setStringAsync(m.content || "");
                  onUnhold();
                }}
              >
                <Text style={[styles.action, { color: palette.color }]}>📋 Copy</Text>
              </Pressable>
            )}
            {onDelete && (
              <Pressable
                onPress={() => {
                  onDelete(m, "me");
                  onUnhold();
                }}
              >
                <Text style={[styles.action, { color: palette.color }]}>🗑 For me</Text>
              </Pressable>
            )}
            {onDelete && canDeleteEveryone && (
              <Pressable
                onPress={() => {
                  onDelete(m, "everyone");
                  onUnhold();
                }}
              >
                <Text style={[styles.action, { color: palette.color }]}>🗑 For everyone</Text>
              </Pressable>
            )}
            <Pressable onPress={onUnhold}>
              <Text style={[styles.action, { color: palette.color }]}>✕</Text>
            </Pressable>
          </View>
        )}
      </Pressable>
    </View>
  );
});

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
  // Messages whose own countdown (see Bubble/useCountdown) has reached zero.
  // Kept separate from server state — a "deleted" broadcast prunes `messages`
  // itself — so this is just belt-and-braces for the gap before it arrives.
  const [expiredIds, setExpiredIds] = useState(() => new Set());

  const visible = useMemo(
    () => (expiredIds.size === 0 ? messages : messages.filter((m) => !expiredIds.has(m.id))),
    [messages, expiredIds]
  );

  // Read via a ref rather than passed as a prop: `byId` gets a new identity on
  // every incoming message, and threading it into Bubble's own props would
  // force every row to re-render each time, which is exactly the per-message
  // full-list churn this file otherwise avoids.
  const byIdRef = useRef(new Map());
  byIdRef.current = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const getReplied = useCallback((id) => byIdRef.current.get(id) || null, []);

  const onExpire = useCallback((id) => {
    setExpiredIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);
  const onHold = useCallback((id) => setHeldId(id), []);
  const onUnhold = useCallback(() => setHeldId(null), []);
  const onPreview = useCallback((m) => setPreview(m), []);

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

  const renderItem = useCallback(
    ({ item: m }) => (
      <Bubble
        message={m}
        mine={m.from === me}
        me={me}
        secure={secure}
        held={heldId === m.id}
        theme={theme}
        getReplied={getReplied}
        onHold={onHold}
        onUnhold={onUnhold}
        onReply={onReply}
        onDelete={onDelete}
        onPreview={onPreview}
        onExpire={onExpire}
      />
    ),
    [me, secure, heldId, theme, getReplied, onHold, onUnhold, onReply, onDelete, onPreview, onExpire]
  );

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
        // Tuned for a chat feed on mid-range Android: a smaller window and
        // batch than the defaults (21 screens, 10/batch with no cap) keep the
        // JS thread from doing rendering work far outside the viewport, which
        // is where scroll jank on lower-end devices actually comes from.
        windowSize={7}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={30}
        initialNumToRender={14}
        removeClippedSubviews
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
