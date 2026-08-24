import { useState } from "react";
import { login } from "../api/auth";

export default function Login({ onLogin, onRegister }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e) {
    e?.preventDefault();

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
      setError(err.message || "نام کاربری یا رمز ورود اشتباهه");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      {/* A real form so password managers and the Enter key both work. */}
      <form style={styles.card} className="card stack" onSubmit={handleLogin}>
        <h2 style={styles.title}>Chatters</h2>

        <input
          className="field"
          placeholder="نام کاربری یا ایمیل"
          autoComplete="username"
          autoCapitalize="none"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
        />

        <input
          className="field"
          type="password"
          placeholder="رمز عبور"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <div className="error-text" style={{ textAlign: "center" }}>{error}</div>}

        <button className="btn btn-block" type="submit" disabled={loading}>
          {loading ? "...درحال ورود" : "ورود"}
        </button>

        {onRegister && (
          <button
            type="button"
            className="btn btn-secondary btn-block"
            onClick={onRegister}
          >
            ساخت حساب جدید
          </button>
        )}
      </form>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100dvh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    paddingTop: "calc(16px + var(--safe-top))",
    paddingBottom: "calc(16px + var(--safe-bottom))",
  },
  card: { width: "100%", maxWidth: 380 },
  title: { margin: 0, textAlign: "center" },
};
