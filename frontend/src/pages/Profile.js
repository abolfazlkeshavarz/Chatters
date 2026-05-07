import { useState } from "react";
import { logout } from "../api/auth";

export default function Profile({ onLogout }) {
  const username = localStorage.getItem("username");

  const [newUsername, setNewUsername] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  function handleLogout() {
    logout();
    onLogout();
  }

  async function handleChangeUsername() {
    if (!newUsername.trim()) {
      setMessage("Please enter a new username");
      return;
    }

    setLoading(true);
    setMessage("");

    const token = localStorage.getItem("token");

    try {
      const res = await fetch(
        "/api/profile/username",
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            new_username: newUsername.trim(),
          }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        setMessage(data.error || "Failed to update username");
        setLoading(false);
        return;
      }

      alert("Username updated. Please log in again.");
      localStorage.clear();
      onLogout();
    } catch {
      setMessage("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleChangePassword() {
    if (!oldPassword || !newPassword) {
      setMessage("Please fill all password fields");
      return;
    }

    setLoading(true);
    setMessage("");

    const token = localStorage.getItem("token");

    try {
      const res = await fetch(
        "/api/profile/password",
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            old_password: oldPassword,
            new_password: newPassword,
          }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        setMessage(data.error || "Failed to update password");
        setLoading(false);
        return;
      }

      setMessage("Password updated successfully");
      setOldPassword("");
      setNewPassword("");
    } catch {
      setMessage("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <h2>Profile</h2>

      {/* Current username */}
      <div style={styles.card}>
        <div style={styles.label}>نام کاربری</div>
        <div style={styles.value}>{username}</div>
      </div>

      {/* Change username */}
      <div style={styles.card}>
        <div style={styles.label}>تغییر نام کاربری</div>
        <input
          style={styles.input}
          placeholder="نام کاربری جدید"
          value={newUsername}
          onChange={e => setNewUsername(e.target.value)}
        />
        <button
          style={styles.button}
          onClick={handleChangeUsername}
          disabled={loading}
        >
          بروزرسانی نام کاربری
        </button>
      </div>

      {/* Change password */}
      <div style={styles.card}>
        <div style={styles.label}>تغییر رمز عبور</div>

        <input
          type="password"
          style={styles.input}
          placeholder= "رمز عبور قدیم"
          value={oldPassword}
          onChange={e => setOldPassword(e.target.value)}
        />

        <input
          type="password"
          style={styles.input}
          placeholder="رمز عبور جدید"
          value={newPassword}
          onChange={e => setNewPassword(e.target.value)}
        />

        <button
          style={styles.button}
          onClick={handleChangePassword}
          disabled={loading}
        >
          بروزرسانی رمز عبور
        </button>
      </div>

      {message && <p style={styles.message}>{message}</p>}

      <button style={styles.logout} onClick={handleLogout}>
        خروج
      </button>
    </div>
  );
}

const styles = {
  page: {
    padding: 16,
    maxWidth: 520,
    margin: "0 auto",
  },
  card: {
    background: "#fff",
    borderRadius: 14,
    border: "1px solid var(--border)",
    padding: 14,
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    color: "var(--subtext)",
    marginBottom: 6,
  },
  value: {
    fontSize: 15,
    fontWeight: 500,
  },
  input: {
    width: "100%",
    padding: 10,
    borderRadius: 10,
    border: "1px solid var(--border)",
    marginBottom: 8,
    fontSize: 14,
  },
  button: {
    padding: 10,
    width: "100%",
    borderRadius: 10,
    border: "none",
    background: "var(--primary)",
    color: "#fff",
    fontSize: 14,
    opacity: 1,
  },
  logout: {
    marginTop: 20,
    padding: 12,
    width: "100%",
    borderRadius: 12,
    border: "none",
    background: "#ff3b30",
    color: "#fff",
    fontSize: 15,
  },
  message: {
    fontSize: 13,
    color: "var(--subtext)",
    textAlign: "center",
    marginTop: 8,
  },
};
