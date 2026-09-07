import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useTheme } from "../theme";

/**
 * Message input bar. Attachments are hidden in secure chats, where files would
 * be stored unencrypted on the server and quietly break the padlock's promise.
 */
export default function Composer({
  onSend,
  onAttach,
  replyTo,
  onCancelReply,
  disabled = false,
  allowAttachments = true,
  placeholder = "پیام",
}) {
  const theme = useTheme();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const canSend = Boolean(text.trim()) && !busy && !disabled;

  async function submit() {
    const body = text.trim();
    if (!body || busy || disabled) return;
    setBusy(true);
    try {
      const ok = await onSend(body);
      if (ok !== false) setText("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: theme.card, borderTopColor: theme.border },
      ]}
    >
      {replyTo && (
        <View
          style={[
            styles.replyBar,
            { backgroundColor: theme.bg, borderLeftColor: theme.primary },
          ]}
        >
          <View style={styles.flex}>
            <Text style={[styles.replyName, { color: theme.text }]}>
              {replyTo.from}
            </Text>
            <Text
              numberOfLines={1}
              style={[styles.replyText, { color: theme.subtext }]}
            >
              {replyTo.content || replyTo.filename || "attachment"}
            </Text>
          </View>
          <Pressable onPress={onCancelReply} hitSlop={8}>
            <Text style={[styles.cancel, { color: theme.subtext }]}>✕</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.bar}>
        {allowAttachments && (
          <Pressable
            onPress={onAttach}
            disabled={disabled}
            style={[styles.iconBtn, { backgroundColor: theme.bg }]}
          >
            <Text style={styles.icon}>📎</Text>
          </Pressable>
        )}

        <TextInput
          value={text}
          onChangeText={setText}
          editable={!disabled}
          placeholder={placeholder}
          placeholderTextColor={theme.subtext}
          multiline
          style={[
            styles.input,
            {
              backgroundColor: theme.bg,
              borderColor: theme.border,
              color: theme.text,
            },
          ]}
        />

        <Pressable
          onPress={submit}
          disabled={!canSend}
          style={[
            styles.send,
            { backgroundColor: theme.primary, opacity: canSend ? 1 : 0.5 },
          ]}
        >
          {busy ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.sendIcon}>➤</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderTopWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1, minWidth: 0 },
  bar: {
    flexDirection: "row",
    padding: 8,
    gap: 8,
    alignItems: "flex-end",
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: { fontSize: 20 },
  input: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
    maxHeight: 120,
    minHeight: 44,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  sendIcon: { color: "#fff", fontSize: 16 },
  replyBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderLeftWidth: 3,
  },
  replyName: { fontSize: 12, fontWeight: "700" },
  replyText: { fontSize: 13 },
  cancel: { fontSize: 16, paddingHorizontal: 4 },
});
