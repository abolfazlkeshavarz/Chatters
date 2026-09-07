import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import Screen from "../components/Screen";
import Avatar from "../components/Avatar";
import { createChat, createSecretChat, deleteChat, getChats } from "../api/chats";
import { addContact, getContacts, removeContact } from "../api/contacts";
import { chatSocket } from "../services/websocket";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../theme";

function formatTime(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m`;
    if (days === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (days === 1) return "Yesterday";
    if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export function chatTitle(chat, me) {
  const others = (chat.members || []).filter((u) => u !== me);
  if (chat.is_group) return chat.name || others.join(", ") || "Group";
  return others[0] || "Saved messages";
}

export default function ChatListScreen({ navigation }) {
  const theme = useTheme();
  const { user: me } = useAuth();

  const [chats, setChats] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null); // 'menu' | 'contacts' | 'direct' | 'group'

  const load = useCallback(async () => {
    try {
      const list = (await getChats()) || [];
      setChats(list);
      setError("");
      return list;
    } catch (err) {
      setError(err.message || "Failed to load chats");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const loadContacts = useCallback(async () => {
    try {
      const { contacts: list } = await getContacts();
      setContacts(list || []);
    } catch {
      /* the contacts modal surfaces its own errors */
    }
  }, []);

  useEffect(() => {
    load();
    loadContacts();
  }, [load, loadContacts]);

  // Refresh whenever this tab regains focus (e.g. returning from a chat).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    chatSocket.start();
    const offMessage = chatSocket.onMessage((msg) => {
      if (
        msg.type === "message" ||
        msg.type === "media" ||
        msg.type === "deleted" ||
        msg.type === "chat_deleted" ||
        msg.type === "e2e_request" ||
        msg.type === "e2e_accepted" ||
        msg.type === "e2e_rejected"
      ) {
        load();
      }
    });
    const offStatus = chatSocket.onStatus((s) => {
      if (s === "reconnected") load();
    });
    return () => {
      offMessage();
      offStatus();
    };
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([load(), loadContacts()]);
    setRefreshing(false);
  }

  async function handleCreate(members, isGroup, name, isSecret) {
    const { chat_id: chatId } = isSecret
      ? await createSecretChat(members[0])
      : await createChat(members, isGroup, name);
    const fresh = await load();
    setModal(null);
    if ((isSecret || !isGroup) && chatId) {
      const created = fresh.find((c) => c.id === chatId);
      if (created) navigation.navigate("Chat", { chat: created });
    }
  }

  function confirmDeleteChat(chat) {
    const scope = chat.is_secret ? "everyone" : "me";
    Alert.alert(
      chat.is_group ? "Leave group?" : "Delete chat?",
      chat.is_secret
        ? "This deletes the secret chat for both of you. Cannot be undone."
        : chat.is_group
        ? "You will stop receiving its messages."
        : "Removes it from your list. The other person keeps their copy.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: chat.is_group ? "Leave" : "Delete",
          style: "destructive",
          onPress: async () => {
            setChats((prev) => prev.filter((c) => c.id !== chat.id));
            try {
              await deleteChat(chat.id, scope);
            } catch {
              load();
            }
          },
        },
      ]
    );
  }

  function renderChat({ item: chat }) {
    const title = chatTitle(chat, me);
    const unread = chat.unread_count > 0;
    let preview;
    if (chat.last_is_encrypted) preview = "🔒 Encrypted message";
    else if (chat.last_message) {
      const prefix =
        chat.last_message_sender === me
          ? "You: "
          : chat.is_group && chat.last_message_sender
          ? `${chat.last_message_sender}: `
          : "";
      preview = prefix + chat.last_message;
    } else preview = "No messages yet";

    if (chat.last_is_system && chat.last_message) preview = chat.last_message;

    return (
      <Pressable
        onPress={() => navigation.navigate("Chat", { chat })}
        onLongPress={() => confirmDeleteChat(chat)}
        style={[
          styles.card,
          { backgroundColor: unread ? theme.unreadBg : theme.card, borderColor: theme.border },
        ]}
      >
        {chat.is_group ? (
          <View style={[styles.groupAvatar, { backgroundColor: theme.primary }]}>
            <Text style={styles.groupAvatarText}>{title[0]?.toUpperCase() || "?"}</Text>
          </View>
        ) : (
          <Avatar userId={title} size={46} />
        )}

        <View style={styles.cardBody}>
          <View style={styles.cardTop}>
            <Text numberOfLines={1} style={[styles.cardTitle, { color: theme.text }]}>
              {chat.e2e_enabled || chat.is_secret ? "🔒 " : ""}
              {title}
              {chat.is_secret ? "  ·  secret" : chat.is_group ? "  ·  group" : ""}
              {chat.self_destruct_seconds > 0 ? "  🔥" : ""}
              {chat.muted ? "  🔕" : ""}
            </Text>
            <Text style={[styles.time, { color: theme.subtext }]}>
              {formatTime(chat.last_message_time)}
            </Text>
          </View>
          {chat.is_secret && chat.e2e_status === "pending" && (
            <Text style={[styles.pending, { color: theme.secure }]}>
              {chat.e2e_requested_by === me
                ? "🔒 Waiting for them to accept…"
                : "🔒 Wants to start a secret chat — tap to respond"}
            </Text>
          )}
          <View style={styles.cardBottom}>
            <Text
              numberOfLines={1}
              style={[
                styles.preview,
                { color: unread ? theme.text : theme.subtext, fontWeight: unread ? "600" : "400" },
              ]}
            >
              {preview}
            </Text>
            {unread && (
              <View style={[styles.badge, { backgroundColor: theme.primary }]}>
                <Text style={styles.badgeText}>
                  {chat.unread_count > 9 ? "9+" : chat.unread_count}
                </Text>
              </View>
            )}
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <Screen edges={["top"]}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <View style={styles.flex}>
          <Text style={[styles.h1, { color: theme.text }]}>Chats</Text>
          <Text style={[styles.sub, { color: theme.subtext }]}>
            Logged in as {me}
          </Text>
        </View>
        <Pressable
          style={[styles.compose, { backgroundColor: theme.primary }]}
          onPress={() => {
            loadContacts();
            setModal("menu");
          }}
        >
          <Text style={styles.composeText}>＋</Text>
        </Pressable>
      </View>

      {error ? (
        <Text style={[styles.error, { color: theme.danger }]}>{error}</Text>
      ) : null}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.primary} />
      ) : (
        <FlatList
          data={chats}
          keyExtractor={(c) => c.id}
          renderItem={renderChat}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={{ fontSize: 40 }}>💬</Text>
              <Text style={{ color: theme.subtext }}>No chats yet</Text>
            </View>
          }
        />
      )}

      <ComposeModals
        visible={modal}
        onClose={() => setModal(null)}
        setModal={setModal}
        contacts={contacts}
        onCreate={handleCreate}
        onAddContact={async (name) => {
          await addContact(name);
          await loadContacts();
        }}
        onRemoveContact={async (id) => {
          await removeContact(id);
          await loadContacts();
        }}
      />
    </Screen>
  );
}

/* --------------------------------------------------------- compose modals */

function ComposeModals({
  visible,
  onClose,
  setModal,
  contacts,
  onCreate,
  onAddContact,
  onRemoveContact,
}) {
  const theme = useTheme();
  const [username, setUsername] = useState("");
  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function reset() {
    setUsername("");
    setGroupName("");
    setSelected([]);
    setErr("");
  }

  const close = () => {
    reset();
    onClose();
  };

  if (!visible) return null;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={close}>
      <Pressable style={[styles.overlay, { backgroundColor: theme.overlay }]} onPress={close}>
        <Pressable
          style={[styles.sheet, { backgroundColor: theme.card }]}
          onPress={(e) => e.stopPropagation()}
        >
          {visible === "menu" && (
            <View style={{ gap: 8 }}>
              {[
                { key: "contacts", label: "👤  Add contact" },
                { key: "direct", label: "💬  New chat" },
                { key: "secret", label: "🔒  New secret chat" },
                { key: "group", label: "👥  New group" },
              ].map((o) => (
                <Pressable
                  key={o.key}
                  style={[styles.menuItem, { borderColor: theme.border }]}
                  onPress={() => {
                    reset();
                    setModal(o.key);
                  }}
                >
                  <Text style={{ color: theme.text, fontSize: 15 }}>{o.label}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {visible === "contacts" && (
            <View style={{ gap: 12 }}>
              <Text style={[styles.sheetTitle, { color: theme.text }]}>Contacts</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput
                  style={[styles.field, { flex: 1, backgroundColor: theme.bg, borderColor: theme.border, color: theme.text }]}
                  placeholder="Add by username"
                  placeholderTextColor={theme.subtext}
                  autoCapitalize="none"
                  value={username}
                  onChangeText={setUsername}
                />
                <Pressable
                  style={[styles.smallBtn, { backgroundColor: theme.primary }]}
                  disabled={busy}
                  onPress={async () => {
                    if (!username.trim()) return;
                    setBusy(true);
                    setErr("");
                    try {
                      await onAddContact(username.trim());
                      setUsername("");
                    } catch (e) {
                      setErr(e.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Text style={styles.smallBtnText}>Add</Text>
                </Pressable>
              </View>
              {err ? <Text style={{ color: theme.danger }}>{err}</Text> : null}
              <FlatList
                style={{ maxHeight: 300 }}
                data={contacts}
                keyExtractor={(c) => c.id}
                ListEmptyComponent={<Text style={{ color: theme.subtext }}>No contacts yet.</Text>}
                renderItem={({ item }) => (
                  <View style={styles.contactRow}>
                    <Avatar userId={item.id} size={36} />
                    <Text style={{ flex: 1, color: theme.text }}>{item.id}</Text>
                    <Pressable onPress={() => onRemoveContact(item.id)}>
                      <Text style={{ color: theme.subtext, fontSize: 18 }}>✕</Text>
                    </Pressable>
                  </View>
                )}
              />
              <Pressable style={styles.closeLink} onPress={close}>
                <Text style={{ color: theme.primary }}>Done</Text>
              </Pressable>
            </View>
          )}

          {(visible === "direct" || visible === "group" || visible === "secret") && (
            <View style={{ gap: 12 }}>
              <Text style={[styles.sheetTitle, { color: theme.text }]}>
                {visible === "group"
                  ? "New group"
                  : visible === "secret"
                  ? "🔒 New secret chat"
                  : "New chat"}
              </Text>
              {visible === "group" && (
                <TextInput
                  style={[styles.field, { backgroundColor: theme.bg, borderColor: theme.border, color: theme.text }]}
                  placeholder="Group name (optional)"
                  placeholderTextColor={theme.subtext}
                  value={groupName}
                  onChangeText={setGroupName}
                />
              )}
              {contacts.length === 0 ? (
                <Pressable style={[styles.smallBtn, { backgroundColor: theme.primary, alignSelf: "center" }]} onPress={() => setModal("contacts")}>
                  <Text style={styles.smallBtnText}>👤  Add a contact</Text>
                </Pressable>
              ) : (
                <FlatList
                  style={{ maxHeight: 320 }}
                  data={contacts}
                  keyExtractor={(c) => c.id}
                  renderItem={({ item }) => {
                    const isSel = selected.includes(item.id);
                    return (
                      <Pressable
                        style={[
                          styles.contactRow,
                          { backgroundColor: isSel ? theme.unreadBg : "transparent", borderRadius: 10 },
                        ]}
                        onPress={async () => {
                          if (visible === "direct" || visible === "secret") {
                            setBusy(true);
                            setErr("");
                            try {
                              await onCreate([item.id], false, "", visible === "secret");
                            } catch (e) {
                              setErr(e.message);
                              setBusy(false);
                            }
                            return;
                          }
                          setSelected((p) =>
                            p.includes(item.id) ? p.filter((x) => x !== item.id) : [...p, item.id]
                          );
                        }}
                      >
                        <Avatar userId={item.id} size={36} />
                        <Text style={{ flex: 1, color: theme.text }}>{item.id}</Text>
                        {visible === "group" && <Text style={{ fontSize: 18 }}>{isSel ? "☑️" : "⬜"}</Text>}
                      </Pressable>
                    );
                  }}
                />
              )}
              {err ? <Text style={{ color: theme.danger }}>{err}</Text> : null}
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 12 }}>
                <Pressable style={styles.closeLink} onPress={close}>
                  <Text style={{ color: theme.subtext }}>Cancel</Text>
                </Pressable>
                {visible === "group" && (
                  <Pressable
                    style={[styles.smallBtn, { backgroundColor: theme.primary, opacity: selected.length && !busy ? 1 : 0.5 }]}
                    disabled={!selected.length || busy}
                    onPress={async () => {
                      setBusy(true);
                      setErr("");
                      try {
                        await onCreate(selected, true, groupName.trim());
                      } catch (e) {
                        setErr(e.message);
                        setBusy(false);
                      }
                    }}
                  >
                    <Text style={styles.smallBtnText}>Create ({selected.length})</Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  h1: { fontSize: 22, fontWeight: "700" },
  sub: { fontSize: 12, marginTop: 2 },
  compose: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  composeText: { color: "#fff", fontSize: 24, lineHeight: 26 },
  error: { padding: 12, fontSize: 13 },
  list: { padding: 12, gap: 8, flexGrow: 1 },
  empty: { alignItems: "center", gap: 8, marginTop: 60 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  groupAvatar: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  groupAvatarText: { color: "#fff", fontSize: 18, fontWeight: "600" },
  cardBody: { flex: 1, minWidth: 0 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  cardTitle: { flex: 1, fontWeight: "500" },
  time: { fontSize: 12 },
  pending: { fontSize: 12, marginTop: 2 },
  cardBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 2 },
  preview: { flex: 1, fontSize: 13 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#fff", fontSize: 12 },

  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  sheet: { width: "100%", maxWidth: 380, borderRadius: 16, padding: 20 },
  sheetTitle: { fontSize: 17, fontWeight: "700" },
  menuItem: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 14 },
  field: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  smallBtn: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, alignItems: "center" },
  smallBtnText: { color: "#fff", fontWeight: "600" },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 4 },
  closeLink: { paddingVertical: 8, paddingHorizontal: 4 },
});
