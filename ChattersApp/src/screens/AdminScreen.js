import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import Screen from "../components/Screen";
import {
  createUser,
  deleteUser,
  getE2ERetention,
  getStats,
  listUsers,
  purgeE2EMessages,
  resetPassword,
  setE2ERetention,
  setRole,
} from "../api/admin";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../theme";

const PAGE_SIZE = 25;
const RETENTION_PRESETS = [
  { label: "Never", seconds: 0 },
  { label: "12 hours", seconds: 12 * 3600 },
  { label: "1 day", seconds: 24 * 3600 },
  { label: "3 days", seconds: 3 * 24 * 3600 },
  { label: "7 days", seconds: 7 * 24 * 3600 },
];

export default function AdminScreen() {
  const theme = useTheme();
  const { user: me } = useAuth();

  const [stats, setStats] = useState({});
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retention, setRetention] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [statsData, userData] = await Promise.all([
        getStats(),
        listUsers({ search, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
      ]);
      setStats(statsData);
      setUsers(userData.users || []);
      setTotal(userData.total || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => {
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
  }, [refresh]);

  useEffect(() => {
    getE2ERetention()
      .then((d) => setRetention(d.retention_seconds ?? 0))
      .catch((err) => setError(err.message));
  }, []);

  function flash(msg) {
    setNotice(msg);
    setTimeout(() => setNotice(""), 4000);
    refresh();
  }

  function confirmDelete(user) {
    Alert.alert(
      `Delete "${user.id}"?`,
      "Their messages, memberships and keys are removed. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteUser(user.id);
              flash(`Deleted ${user.id}`);
            } catch (err) {
              setError(err.message);
            }
          },
        },
      ]
    );
  }

  async function toggleAdmin(user) {
    try {
      await setRole(user.id, !user.is_admin);
      flash(`${user.id} is now ${!user.is_admin ? "an administrator" : "a regular user"}`);
    } catch (err) {
      setError(err.message);
    }
  }

  function promptReset(user) {
    Alert.prompt?.(
      `Reset password for ${user.id}`,
      "Enter a new password (min 8 characters)",
      async (value) => {
        if (!value || value.length < 8) return setError("Password too short");
        try {
          await resetPassword(user.id, value);
          flash(`Password reset for ${user.id}`);
        } catch (err) {
          setError(err.message);
        }
      },
      "secure-text"
    ) ??
      Alert.alert(
        "Reset password",
        "Password reset with a typed value is iOS-only here. Use the web admin panel on Android."
      );
  }

  async function changeRetention(seconds) {
    setRetention(seconds);
    try {
      await setE2ERetention(seconds);
      const p = RETENTION_PRESETS.find((x) => x.seconds === seconds);
      flash(`Encrypted-chat auto-delete: ${p?.label || `${seconds}s`}`);
    } catch (err) {
      setError(err.message);
    }
  }

  function confirmPurge() {
    Alert.alert(
      "Delete all encrypted messages?",
      "Clears the content of every message in every secure chat immediately, for all users. The chats stay. Cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete all",
          style: "destructive",
          onPress: async () => {
            try {
              const res = await purgeE2EMessages();
              flash(`Deleted ${res.deleted} encrypted message(s)`);
            } catch (err) {
              setError(err.message);
            }
          },
        },
      ]
    );
  }

  const pages = Math.ceil(total / PAGE_SIZE) || 1;

  return (
    <Screen edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.h1, { color: theme.text }]}>Administration</Text>
        <Text style={{ color: theme.subtext }}>Signed in as {me}</Text>

        <View style={styles.statGrid}>
          {[
            ["Users", stats.users],
            ["Chats", stats.chats],
            ["Messages", stats.messages],
            ["Secure chats", stats.e2e_chats],
            ["Encrypted msgs", stats.encrypted_messages],
          ].map(([label, value]) => (
            <View key={label} style={[styles.stat, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Text style={[styles.statValue, { color: theme.text }]}>{value ?? "—"}</Text>
              <Text style={{ color: theme.subtext, fontSize: 12 }}>{label}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={{ fontWeight: "600", color: theme.text }}>🔒 Encrypted chat data retention</Text>
          <Text style={{ color: theme.subtext, fontSize: 12, marginVertical: 6 }}>
            Auto-deletes messages in secure chats once they reach this age.
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {RETENTION_PRESETS.map((p) => (
              <Pressable
                key={p.seconds}
                onPress={() => changeRetention(p.seconds)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: retention === p.seconds ? theme.primary : theme.bg,
                    borderColor: theme.border,
                  },
                ]}
              >
                <Text style={{ color: retention === p.seconds ? "#fff" : theme.text, fontSize: 13 }}>
                  {p.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={[styles.btn, { backgroundColor: theme.danger, marginTop: 10 }]} onPress={confirmPurge}>
            <Text style={styles.btnText}>Delete all encrypted messages now</Text>
          </Pressable>
        </View>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput
            style={[styles.field, { flex: 1, backgroundColor: theme.bg, borderColor: theme.border, color: theme.text }]}
            placeholder="Search username or email"
            placeholderTextColor={theme.subtext}
            autoCapitalize="none"
            value={search}
            onChangeText={(t) => {
              setPage(0);
              setSearch(t);
            }}
          />
          <Pressable style={[styles.btn, { backgroundColor: theme.primary, paddingHorizontal: 14 }]} onPress={() => setShowCreate(true)}>
            <Text style={styles.btnText}>+ New</Text>
          </Pressable>
        </View>

        {error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}
        {notice ? <Text style={{ color: theme.secure }}>{notice}</Text> : null}

        {loading ? (
          <ActivityIndicator color={theme.primary} style={{ marginTop: 20 }} />
        ) : (
          users.map((u) => (
            <View key={u.id} style={[styles.userRow, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontWeight: "600" }}>
                  {u.id}
                  {u.id === me ? "  (you)" : ""}
                  {u.is_admin ? "  · admin" : ""}
                </Text>
                <Text style={{ color: theme.subtext, fontSize: 12 }}>{u.email}</Text>
                <Text style={{ color: theme.subtext, fontSize: 12 }}>
                  {u.chat_count} chats · key {u.has_keys ? "yes" : "none"}
                </Text>
              </View>
              <View style={{ gap: 6 }}>
                <Pressable style={[styles.tinyBtn, { borderColor: theme.border }]} onPress={() => promptReset(u)}>
                  <Text style={{ color: theme.text, fontSize: 12 }}>Reset</Text>
                </Pressable>
                <Pressable
                  style={[styles.tinyBtn, { borderColor: theme.border, opacity: u.id === me ? 0.4 : 1 }]}
                  disabled={u.id === me}
                  onPress={() => toggleAdmin(u)}
                >
                  <Text style={{ color: theme.text, fontSize: 12 }}>{u.is_admin ? "Demote" : "Promote"}</Text>
                </Pressable>
                <Pressable
                  style={[styles.tinyBtn, { borderColor: theme.danger, opacity: u.id === me ? 0.4 : 1 }]}
                  disabled={u.id === me}
                  onPress={() => confirmDelete(u)}
                >
                  <Text style={{ color: theme.danger, fontSize: 12 }}>Delete</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}

        {pages > 1 && (
          <View style={styles.pager}>
            <Pressable disabled={page === 0} onPress={() => setPage((p) => p - 1)}>
              <Text style={{ color: page === 0 ? theme.subtext : theme.primary }}>‹ Prev</Text>
            </Pressable>
            <Text style={{ color: theme.subtext }}>
              {page + 1} / {pages}
            </Text>
            <Pressable disabled={page + 1 >= pages} onPress={() => setPage((p) => p + 1)}>
              <Text style={{ color: page + 1 >= pages ? theme.subtext : theme.primary }}>Next ›</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      <CreateUserModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(id) => {
          setShowCreate(false);
          flash(`Created ${id}`);
        }}
      />
    </Screen>
  );
}

function CreateUserModal({ visible, onClose, onCreated }) {
  const theme = useTheme();
  const [form, setForm] = useState({ username: "", email: "", password: "", isAdmin: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const up = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  async function submit() {
    if (!form.username || !form.email || !form.password) return setErr("All fields required");
    setBusy(true);
    setErr("");
    try {
      const res = await createUser(form);
      onCreated(res.username || form.username);
      setForm({ username: "", email: "", password: "", isAdmin: false });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const f = { backgroundColor: theme.bg, borderColor: theme.border, color: theme.text };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.overlay, { backgroundColor: theme.overlay }]} onPress={onClose}>
        <Pressable style={[styles.modalCard, { backgroundColor: theme.card }]} onPress={(e) => e.stopPropagation()}>
          <Text style={[styles.h1, { color: theme.text, fontSize: 18 }]}>New user</Text>
          <TextInput style={[styles.field, f]} placeholder="Username" placeholderTextColor={theme.subtext} autoCapitalize="none" value={form.username} onChangeText={up("username")} />
          <TextInput style={[styles.field, f]} placeholder="Email" placeholderTextColor={theme.subtext} autoCapitalize="none" keyboardType="email-address" value={form.email} onChangeText={up("email")} />
          <TextInput style={[styles.field, f]} placeholder="Password" placeholderTextColor={theme.subtext} secureTextEntry value={form.password} onChangeText={up("password")} />
          <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 }} onPress={() => up("isAdmin")(!form.isAdmin)}>
            <Text style={{ fontSize: 18 }}>{form.isAdmin ? "☑️" : "⬜"}</Text>
            <Text style={{ color: theme.text }}>Administrator</Text>
          </Pressable>
          {err ? <Text style={{ color: theme.danger }}>{err}</Text> : null}
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 8 }}>
            <Pressable onPress={onClose}><Text style={{ color: theme.subtext, padding: 8 }}>Cancel</Text></Pressable>
            <Pressable style={[styles.btn, { backgroundColor: theme.primary, paddingHorizontal: 16 }]} disabled={busy} onPress={submit}>
              <Text style={styles.btnText}>{busy ? "…" : "Create"}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  h1: { fontSize: 22, fontWeight: "700" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    minWidth: 100,
    flexGrow: 1,
  },
  statValue: { fontSize: 20, fontWeight: "700" },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
  field: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
  },
  btn: { borderRadius: 10, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  btnText: { color: "#fff", fontWeight: "600" },
  userRow: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tinyBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: "center",
  },
  pager: { flexDirection: "row", justifyContent: "center", gap: 20, alignItems: "center", paddingVertical: 8 },
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { width: "100%", maxWidth: 380, borderRadius: 16, padding: 20, gap: 10 },
});
