import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";

import Screen from "../components/Screen";
import Avatar from "../components/Avatar";
import { api } from "../api/client";
import { getMe } from "../api/auth";
import { deleteAvatar, setAvatarVisibility, uploadAvatar } from "../api/avatar";
import { loadIdentity } from "../crypto/keystore";
import { generateIdentity, wrapIdentity, isSupported } from "../crypto/e2ee";
import {
  registerForPush,
  unregisterForPush,
  getStoredPushToken,
} from "../services/notifications";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../theme";

function Section({ title, children }) {
  const theme = useTheme();
  return (
    <View style={[styles.section, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Text style={[styles.sectionTitle, { color: theme.subtext }]}>{title}</Text>
      {children}
    </View>
  );
}

export default function ProfileScreen() {
  const theme = useTheme();
  const { user: username, signOut } = useAuth();

  const [newUsername, setNewUsername] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [hasKey, setHasKey] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  const [hasAvatar, setHasAvatar] = useState(false);
  const [visibility, setVisibility] = useState("public");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarBust, setAvatarBust] = useState(0);

  useEffect(() => {
    loadIdentity(username).then((id) => setHasKey(Boolean(id)));
    getStoredPushToken().then((t) => setPushOn(Boolean(t)));
    getMe()
      .then((me) => {
        setHasAvatar(Boolean(me.has_avatar));
        setVisibility(me.avatar_visibility || "public");
      })
      .catch(() => {});
  }, [username]);

  function note(msg) {
    setMessage(msg);
    setError("");
  }

  async function pickAvatar() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
    });
    if (res.canceled) return;
    const asset = res.assets[0];
    setAvatarBusy(true);
    setError("");
    try {
      await uploadAvatar({ uri: asset.uri, name: asset.fileName, mimeType: asset.mimeType });
      setHasAvatar(true);
      setAvatarBust((n) => n + 1);
      note("Profile photo updated");
    } catch (err) {
      setError(err.message);
    } finally {
      setAvatarBusy(false);
    }
  }

  async function removeAvatar() {
    setAvatarBusy(true);
    try {
      await deleteAvatar();
      setHasAvatar(false);
      setAvatarBust((n) => n + 1);
      note("Profile photo removed");
    } catch (err) {
      setError(err.message);
    } finally {
      setAvatarBusy(false);
    }
  }

  async function changeVisibility(next) {
    const prev = visibility;
    setVisibility(next);
    try {
      await setAvatarVisibility(next);
    } catch (err) {
      setVisibility(prev);
      setError(err.message);
    }
  }

  async function togglePush() {
    setPushBusy(true);
    setError("");
    try {
      if (pushOn) {
        await unregisterForPush();
        setPushOn(false);
        note("Notifications turned off");
      } else {
        const token = await registerForPush();
        if (!token) {
          setError("Notification permission was not granted.");
        } else {
          setPushOn(true);
          note("Notifications turned on");
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPushBusy(false);
    }
  }

  async function changeUsername() {
    if (!newUsername.trim()) return setError("Please enter a new username");
    setLoading(true);
    setError("");
    try {
      await api.put("/api/profile/username", { new_username: newUsername.trim() });
      Alert.alert("Username updated", "Please sign in again.", [
        { text: "OK", onPress: signOut },
      ]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function changePassword() {
    if (!oldPassword || !newPassword) return setError("Please fill both password fields");
    setLoading(true);
    setError("");
    try {
      let keys;
      if (isSupported()) {
        try {
          const stored = await loadIdentity(username);
          if (stored) keys = await wrapIdentity(await generateIdentity(), newPassword);
        } catch {
          keys = undefined;
        }
      }
      await api.put("/api/profile/password", {
        old_password: oldPassword,
        new_password: newPassword,
        keys,
      });
      Alert.alert("Password updated", "Please sign in again.", [
        { text: "OK", onPress: signOut },
      ]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const f = { backgroundColor: theme.bg, borderColor: theme.border, color: theme.text };

  return (
    <Screen edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.h1, { color: theme.text }]}>Profile</Text>

        <Section title="نام کاربری">
          <Text style={{ fontSize: 16, fontWeight: "500", color: theme.text }}>{username}</Text>
        </Section>

        <Section title="📷 Profile photo">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <Avatar userId={username} size={64} bust={avatarBust} />
            <View style={{ flex: 1, gap: 6 }}>
              <Pressable
                style={[styles.btnSecondary, { borderColor: theme.border }]}
                onPress={pickAvatar}
                disabled={avatarBusy}
              >
                <Text style={{ color: theme.text }}>
                  {avatarBusy ? "…" : hasAvatar ? "Change photo" : "Upload photo"}
                </Text>
              </Pressable>
              {hasAvatar && (
                <Pressable
                  style={[styles.btnSecondary, { borderColor: theme.border }]}
                  onPress={removeAvatar}
                  disabled={avatarBusy}
                >
                  <Text style={{ color: theme.text }}>Remove photo</Text>
                </Pressable>
              )}
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            {["public", "contacts"].map((v) => (
              <Pressable
                key={v}
                onPress={() => changeVisibility(v)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: visibility === v ? theme.primary : theme.bg,
                    borderColor: theme.border,
                  },
                ]}
              >
                <Text style={{ color: visibility === v ? "#fff" : theme.text, fontSize: 13 }}>
                  {v === "public" ? "Everyone" : "My contacts only"}
                </Text>
              </Pressable>
            ))}
          </View>
        </Section>

        <Section title="🔔 Notifications">
          <Pressable
            style={[styles.btn, { backgroundColor: pushOn ? theme.bg : theme.primary, borderColor: theme.border, borderWidth: pushOn ? StyleSheet.hairlineWidth : 0 }]}
            onPress={togglePush}
            disabled={pushBusy}
          >
            {pushBusy ? (
              <ActivityIndicator color={pushOn ? theme.text : "#fff"} />
            ) : (
              <Text style={{ color: pushOn ? theme.text : "#fff", fontWeight: "600" }}>
                {pushOn ? "Turn off notifications" : "Turn on notifications"}
              </Text>
            )}
          </Pressable>
        </Section>

        <Section title="🔒 Encryption">
          <Text style={{ color: theme.text, fontSize: 14 }}>
            {hasKey
              ? "Your encryption key is unlocked on this device. Secure chats open normally."
              : "No encryption key on this device. Sign out and back in to unlock secure chats."}
          </Text>
        </Section>

        <Section title="تغییر نام کاربری">
          <TextInput
            style={[styles.field, f]}
            placeholder="نام کاربری جدید"
            placeholderTextColor={theme.subtext}
            autoCapitalize="none"
            value={newUsername}
            onChangeText={setNewUsername}
          />
          <Pressable style={[styles.btn, { backgroundColor: theme.primary }]} onPress={changeUsername} disabled={loading}>
            <Text style={styles.btnText}>بروزرسانی نام کاربری</Text>
          </Pressable>
        </Section>

        <Section title="تغییر رمز عبور">
          <TextInput
            style={[styles.field, f]}
            placeholder="رمز عبور قدیم"
            placeholderTextColor={theme.subtext}
            secureTextEntry
            value={oldPassword}
            onChangeText={setOldPassword}
          />
          <TextInput
            style={[styles.field, f]}
            placeholder="رمز عبور جدید (حداقل ۸ کاراکتر)"
            placeholderTextColor={theme.subtext}
            secureTextEntry
            value={newPassword}
            onChangeText={setNewPassword}
          />
          <Text style={{ color: theme.subtext, fontSize: 12 }}>
            Changing your password issues a new encryption key. Existing secure chats stay
            readable only where your old key is still stored.
          </Text>
          <Pressable style={[styles.btn, { backgroundColor: theme.primary }]} onPress={changePassword} disabled={loading}>
            <Text style={styles.btnText}>بروزرسانی رمز عبور</Text>
          </Pressable>
        </Section>

        {error ? <Text style={{ color: theme.danger }}>{error}</Text> : null}
        {message ? <Text style={{ color: theme.subtext }}>{message}</Text> : null}

        <Pressable style={[styles.btn, { backgroundColor: theme.danger }]} onPress={signOut}>
          <Text style={styles.btnText}>خروج</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14 },
  h1: { fontSize: 22, fontWeight: "700" },
  section: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 10,
  },
  sectionTitle: { fontSize: 13 },
  field: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
  },
  btn: { borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "600" },
  btnSecondary: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    alignItems: "center",
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
