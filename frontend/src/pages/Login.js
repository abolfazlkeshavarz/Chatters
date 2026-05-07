import { useState } from "react";
import { login } from "../api/auth";

export default function Login({ onLogin, onRegister }) {
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
      await login(identifier, password);
      onLogin();
    } catch (err) {
      setError("نام کاربری یا رمز ورود اشتباهه ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h2 style={styles.title}>Chatters</h2>
        <p style={styles.subtitle}>
         .ظرفیت ها پر شد
        </p>

        <input
          style={styles.input}
          placeholder="نام کاربری(حساس به کوچیک بزرگ بودن حروف)"
          value={identifier}
          onChange={e => setIdentifier(e.target.value)}
        />

        <input
          type="password"
          style={styles.input}
          placeholder="رمز عبور"
          value={password}
          onChange={e => setPassword(e.target.value)}
        />

        {error && <div style={styles.error}>{error}</div>}

        <button
          style={styles.button}
          onClick={handleLogin}
          disabled={loading}
        >
          {loading ? "...درحال ورود" : "ورود"}
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
  divider: {
  marginTop: 16,
  marginBottom: 8,
  fontSize: 13,
  color: "var(--subtext)",
  textAlign: "center",
  },

  secondary: {
    width: "100%",
    padding: "10px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "#fff",
    color: "var(--primary)",
    fontSize: 14,
    fontWeight: 500,
  },

};
