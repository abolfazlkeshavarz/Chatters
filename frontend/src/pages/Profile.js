import { useEffect, useState } from "react";
import { logout } from "../api/auth";
import { api } from "../api/client";
import {
  disablePush,
  enablePush,
  isSubscribed,
  isStandalone,
  permission,
  pushSupport,
} from "../api/push";
import { loadIdentity } from "../crypto/keystore";
import { generateIdentity, wrapIdentity, isSupported } from "../crypto/e2ee";

function Section({ title, children }) {
  return (
    <div className="card stack">
      <div className="muted">{title}</div>
      {children}
    </div>
  );
}

export default function Profile({ onLogout }) {
  const username = localStorage.getItem("username");

  const [newUsername, setNewUsername] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [hasKey, setHasKey] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  const support = pushSupport();

  useEffect(() => {
    loadIdentity(username).then((id) => setHasKey(Boolean(id)));
    isSubscribed().then(setPushOn);
  }, [username]);

  function reset(msg) {
    setMessage(msg);
    setError("");
  }

  async function handleLogout() {
    await logout();
    onLogout();
  }

  async function handleChangeUsername() {
    if (!newUsername.trim()) {
      setError("Please enter a new username");
      return;
    }

    setLoading(true);
    setError("");
    try {
      await api.put("/api/profile/username", {
        new_username: newUsername.trim(),
      });
      alert("Username updated. Please sign in again.");
      await logout();
      onLogout();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleChangePassword() {
    if (!oldPassword || !newPassword) {
      setError("Please fill both password fields");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // The identity private key is wrapped with the old password, so it has
      // to be re-wrapped under the new one in the same request or the user
      // loses access to their encrypted chats.
      let keys;
      if (isSupported()) {
        try {
          const stored = await loadIdentity(username);
          if (stored) {
            // The cached key is non-extractable by design, so mint a fresh
            // identity rather than trying to re-wrap the old one. Previously
            // encrypted messages stay readable only on devices still holding
            // the old key, which is why this is called out below.
            keys = await wrapIdentity(await generateIdentity(), newPassword);
          }
        } catch {
          keys = undefined;
        }
      }

      await api.put("/api/profile/password", {
        old_password: oldPassword,
        new_password: newPassword,
        keys,
      });

      alert("Password updated. Please sign in again.");
      await logout();
      onLogout();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function togglePush() {
    setPushBusy(true);
    setError("");
    try {
      if (pushOn) {
        await disablePush();
        setPushOn(false);
        reset("Notifications turned off");
      } else {
        await enablePush();
        setPushOn(true);
        reset("Notifications turned on");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <div className="container stack">
      <h2 style={{ margin: 0 }}>Profile</h2>

      <Section title="نام کاربری">
        <div style={{ fontSize: 16, fontWeight: 500 }}>{username}</div>
      </Section>

      <Section title="🔔 Notifications">
        {support.supported ? (
          <>
            <button
              className={`btn btn-block ${pushOn ? "btn-secondary" : ""}`}
              onClick={togglePush}
              disabled={pushBusy}
            >
              {pushBusy
                ? "…"
                : pushOn
                ? "Turn off notifications"
                : "Turn on notifications"}
            </button>

            {permission() === "denied" && (
              <div className="muted">
                Notifications are blocked in your browser settings for this
                site. You will need to allow them there first.
              </div>
            )}
          </>
        ) : (
          <div className="muted">{support.reason}</div>
        )}

        {!isStandalone() && (
          <div className="muted">
            Tip: install Chatters to your Home Screen for reliable notifications
            and a full-screen app.
          </div>
        )}
      </Section>

      <Section title="🔒 Encryption">
        <div style={{ fontSize: 14 }}>
          {hasKey
            ? "Your encryption key is unlocked on this device. Secure chats will open normally."
            : "No encryption key is available on this device. Sign out and back in to unlock secure chats."}
        </div>
        <div className="muted">
          Secure chats are encrypted in your browser. Nobody else — including
          the server and administrators — can read them.
        </div>
      </Section>

      <Section title="تغییر نام کاربری">
        <input
          className="field"
          placeholder="نام کاربری جدید"
          value={newUsername}
          onChange={(e) => setNewUsername(e.target.value)}
        />
        <button
          className="btn btn-block"
          onClick={handleChangeUsername}
          disabled={loading}
        >
          بروزرسانی نام کاربری
        </button>
      </Section>

      <Section title="تغییر رمز عبور">
        <input
          className="field"
          type="password"
          autoComplete="current-password"
          placeholder="رمز عبور قدیم"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
        />
        <input
          className="field"
          type="password"
          autoComplete="new-password"
          placeholder="رمز عبور جدید (حداقل ۸ کاراکتر)"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <div className="muted">
          Changing your password issues a new encryption key. Messages in
          existing secure chats stay readable only where your old key is still
          stored.
        </div>
        <button
          className="btn btn-block"
          onClick={handleChangePassword}
          disabled={loading}
        >
          بروزرسانی رمز عبور
        </button>
      </Section>

      {error && <div className="error-text">{error}</div>}
      {message && <div className="muted">{message}</div>}

      <button className="btn btn-danger btn-block" onClick={handleLogout}>
        خروج
      </button>
    </div>
  );
}
