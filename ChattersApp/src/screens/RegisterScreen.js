import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import Screen from "../components/Screen";
import { register } from "../api/auth";
import { useTheme } from "../theme";

export default function RegisterScreen({ navigation }) {
  const theme = useTheme();
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const update = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function handleRegister() {
    if (!form.username || !form.email || !form.password) {
      setError("Please fill all fields");
      return;
    }
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await register(form.username.trim(), form.email.trim(), form.password);
      Alert.alert("Account created", `Your username is: ${res.username}`, [
        { text: "OK", onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  const f = {
    backgroundColor: theme.bg,
    borderColor: theme.border,
    color: theme.text,
  };

  return (
    <Screen keyboardAvoiding style={styles.center}>
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.title, { color: theme.text }]}>Create account</Text>

        <TextInput
          style={[styles.field, f]}
          placeholder="نام کاربری"
          placeholderTextColor={theme.subtext}
          autoCapitalize="none"
          value={form.username}
          onChangeText={update("username")}
        />
        <TextInput
          style={[styles.field, f]}
          placeholder="Email address"
          placeholderTextColor={theme.subtext}
          autoCapitalize="none"
          keyboardType="email-address"
          value={form.email}
          onChangeText={update("email")}
        />
        <TextInput
          style={[styles.field, f]}
          placeholder="رمز (حداقل ۸ کاراکتر)"
          placeholderTextColor={theme.subtext}
          secureTextEntry
          value={form.password}
          onChangeText={update("password")}
        />

        <Text style={[styles.hint, { color: theme.subtext }]}>
          3–32 characters: letters, digits, dot, underscore or hyphen.
        </Text>

        {error ? <Text style={[styles.error, { color: theme.danger }]}>{error}</Text> : null}

        <Pressable
          style={[styles.btn, { backgroundColor: theme.primary }]}
          onPress={handleRegister}
          disabled={loading}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Register</Text>}
        </Pressable>
        <Pressable
          style={[styles.btn, styles.secondary, { borderColor: theme.border }]}
          onPress={() => navigation.goBack()}
        >
          <Text style={[styles.btnText, { color: theme.text }]}>Back to sign in</Text>
        </Pressable>
      </View>
    </Screen>
  );
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
  title: { fontSize: 22, fontWeight: "700", textAlign: "center" },
  field: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  hint: { fontSize: 12, textAlign: "center", lineHeight: 18 },
  error: { textAlign: "center", fontSize: 13 },
  btn: { borderRadius: 10, paddingVertical: 13, alignItems: "center" },
  secondary: { backgroundColor: "transparent", borderWidth: StyleSheet.hairlineWidth },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
