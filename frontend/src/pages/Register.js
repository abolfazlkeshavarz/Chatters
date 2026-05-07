import { useState } from "react";
import { register } from "../api/auth";

export default function Register({ onRegister }) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    if (!username || !email || !password) {
      setError("Please fill all fields");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await register(username, email, password);

      alert(
        `Account created successfully.\nYour username is: ${res.username}`
      );

      onRegister();
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h2 style={styles.title}>Create Account</h2>
        <p style={styles.subtitle}>
          Choose a unique username
        </p>

        <input
          style={styles.input}
          placeholder="نام کاربری(حساس به حروف کوچیک و بزرگ)"
          value={username}
          onChange={e => setUsername(e.target.value)}
        />

        <input
          style={styles.input}
          placeholder="Email address"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />

        <input
          type="password"
          style={styles.input}
          placeholder="رمز"
          value={password}
          onChange={e => setPassword(e.target.value)}
        />

        <div style={styles.hint}>
          If a username is taken, add numbers or letters
          <br />
          مثال: <strong>ali9x3f</strong>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <button
          style={styles.button}
          onClick={handleRegister}
          disabled={loading}
        >
          {loading ? "Creating account..." : "Register"}
        </button>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--bg)",
    padding: 16,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    background: "#fff",
    borderRadius: 18,
    padding: 24,
    border: "1px solid var(--border)",
  },
  title: {
    margin: 0,
    marginBottom: 6,
    textAlign: "center",
  },
  subtitle: {
    marginTop: 0,
    marginBottom: 20,
    textAlign: "center",
    fontSize: 14,
    color: "var(--subtext)",
  },
  input: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    fontSize: 14,
    marginBottom: 12,
  },
  hint: {
    fontSize: 12,
    color: "var(--subtext)",
    textAlign: "center",
    marginBottom: 12,
    lineHeight: 1.6,
  },
  button: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 12,
    border: "none",
    background: "var(--primary)",
    color: "#fff",
    fontSize: 15,
    fontWeight: 500,
    marginTop: 8,
  },
  error: {
    fontSize: 13,
    color: "#ff3b30",
    marginBottom: 8,
    textAlign: "center",
  },
};
