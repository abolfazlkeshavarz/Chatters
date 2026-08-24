import { useState } from "react";
import { register } from "../api/auth";

export default function Register({ onRegister, onBack }) {
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const update = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleRegister(e) {
    e?.preventDefault();

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
      const res = await register(form.username, form.email, form.password);
      alert(`Account created. Your username is: ${res.username}`);
      onRegister();
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <form style={styles.card} className="card stack" onSubmit={handleRegister}>
        <h2 style={styles.title}>Create account</h2>

        <input
          className="field"
          placeholder="نام کاربری (حساس به حروف کوچیک و بزرگ)"
          autoComplete="username"
          autoCapitalize="none"
          value={form.username}
          onChange={update("username")}
        />

        <input
          className="field"
          type="email"
          placeholder="Email address"
          autoComplete="email"
          autoCapitalize="none"
          value={form.email}
          onChange={update("email")}
        />

        <input
          className="field"
          type="password"
          placeholder="رمز (حداقل ۸ کاراکتر)"
          autoComplete="new-password"
          value={form.password}
          onChange={update("password")}
        />

        <div className="muted" style={{ textAlign: "center", lineHeight: 1.6 }}>
          3–32 characters: letters, digits, dot, underscore or hyphen.
          <br />
          If a username is taken, add numbers — e.g. <strong>ali9x3f</strong>
        </div>

        {error && <div className="error-text" style={{ textAlign: "center" }}>{error}</div>}

        <button className="btn btn-block" type="submit" disabled={loading}>
          {loading ? "Creating account…" : "Register"}
        </button>

        {onBack && (
          <button type="button" className="btn btn-secondary btn-block" onClick={onBack}>
            Back to sign in
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
