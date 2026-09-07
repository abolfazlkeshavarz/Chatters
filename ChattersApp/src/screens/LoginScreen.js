import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import Screen from "../components/Screen";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../theme";

// Self-service signup is off, matching the web app. Administrators create
// accounts from the admin panel. Flip to true to show the "create account" link.
export const REGISTRATION_OPEN = false;

export default function LoginScreen({ navigation }) {
  const theme = useTheme();
  const { signIn } = useAuth();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!identifier || !password) {
      setError("فیلدا رو پر کن");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await signIn(identifier.trim(), password);
    } catch (err) {
      setError(err.message || "نام کاربری یا رمز ورود اشتباهه");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen keyboardAvoiding style={styles.center}>
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.title, { color: theme.text }]}>Chatters</Text>

        <TextInput
          style={[styles.field, fieldTheme(theme)]}
          placeholder="نام کاربری یا ایمیل"
          placeholderTextColor={theme.subtext}
          autoCapitalize="none"
          autoCorrect={false}
          value={identifier}
          onChangeText={setIdentifier}
        />
        <TextInput
          style={[styles.field, fieldTheme(theme)]}
          placeholder="رمز عبور"
          placeholderTextColor={theme.subtext}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {error ? (
          <Text style={[styles.error, { color: theme.danger }]}>{error}</Text>
        ) : null}

        <Pressable
          style={[styles.btn, { backgroundColor: theme.primary }]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>ورود</Text>
          )}
        </Pressable>

        {REGISTRATION_OPEN && (
          <Pressable
            style={[styles.btn, styles.secondary, { borderColor: theme.border }]}
            onPress={() => navigation.navigate("Register")}
          >
            <Text style={[styles.btnText, { color: theme.text }]}>ساخت حساب جدید</Text>
          </Pressable>
        )}
      </View>
    </Screen>
  );
}

function fieldTheme(theme) {
  return {
    backgroundColor: theme.bg,
    borderColor: theme.border,
    color: theme.text,
  };
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center", padding: 16 },
  card: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
    gap: 12,
  },
  title: { fontSize: 24, fontWeight: "700", textAlign: "center", marginBottom: 4 },
  field: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  error: { textAlign: "center", fontSize: 13 },
  btn: {
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },
  secondary: { backgroundColor: "transparent", borderWidth: StyleSheet.hairlineWidth },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
