import { useCallback, useEffect, useState } from "react";
import {
  createUser,
  deleteUser,
  getStats,
  listUsers,
  resetPassword,
  setRole,
} from "../api/admin";

const PAGE_SIZE = 25;

function StatCard({ label, value }) {
  return (
    <div className="card" style={styles.stat}>
      <div style={styles.statValue}>{value ?? "—"}</div>
      <div className="muted">{label}</div>
    </div>
  );
}

function CreateUserModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    isAdmin: false,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const update = (k) => (e) =>
    setForm((f) => ({
      ...f,
      [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await createUser(form);
      onCreated(`Created ${form.username}`);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: 20 }} className="stack">
          <h3 style={{ margin: 0 }}>New user</h3>

          <input
            className="field"
            placeholder="Username"
            autoComplete="off"
            value={form.username}
            onChange={update("username")}
          />
          <input
            className="field"
            placeholder="Email"
            type="email"
            autoComplete="off"
            value={form.email}
            onChange={update("email")}
          />
          <input
            className="field"
            placeholder="Temporary password (min 8 characters)"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={update("password")}
          />

          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={form.isAdmin}
              onChange={update("isAdmin")}
            />
            <span>Grant administrator access</span>
          </label>

          <p className="muted" style={{ margin: 0 }}>
            The account generates its own encryption key the first time it signs
            in — you never hold it.
          </p>

          {error && <div className="error-text">{error}</div>}

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn" onClick={submit} disabled={busy}>
              {busy ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordModal({ user, onClose, onDone }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await resetPassword(user.id, password);
      onDone(`Password reset for ${user.id}`);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: 20 }} className="stack">
          <h3 style={{ margin: 0 }}>Reset password — {user.id}</h3>

          <div style={styles.warning}>
            <strong>This clears the user's encryption keys.</strong> Their
            private key is locked with their old password, which nobody
            (including this server) can recover. They will get a new key on next
            sign-in and will not be able to read their existing encrypted
            messages.
          </div>

          <input
            className="field"
            placeholder="New password (min 8 characters)"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error && <div className="error-text">{error}</div>}

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={submit} disabled={busy}>
              {busy ? "Resetting…" : "Reset password"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Admin() {
  const me = localStorage.getItem("username");

  const [stats, setStats] = useState({});
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [resetting, setResetting] = useState(null);

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

  // Debounced so typing in the search box does not fire a request per keypress.
  useEffect(() => {
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
  }, [refresh]);

  function flash(message) {
    setNotice(message);
    setTimeout(() => setNotice(""), 4000);
    refresh();
  }

  async function handleDelete(user) {
    if (
      !window.confirm(
        `Permanently delete "${user.id}"?\n\n` +
          "Their messages, chat memberships and encryption keys are removed. This cannot be undone."
      )
    ) {
      return;
    }

    try {
      await deleteUser(user.id);
      flash(`Deleted ${user.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggleAdmin(user) {
    try {
      await setRole(user.id, !user.is_admin);
      flash(`${user.id} is now ${!user.is_admin ? "an administrator" : "a regular user"}`);
    } catch (err) {
      setError(err.message);
    }
  }

  const pages = Math.ceil(total / PAGE_SIZE) || 1;

  return (
    <div className="container stack">
      <div>
        <h2 style={{ margin: 0 }}>Administration</h2>
        <div className="muted">
          Signed in as <strong>{me}</strong>
        </div>
      </div>

      <div style={styles.statGrid}>
        <StatCard label="Users" value={stats.users} />
        <StatCard label="Chats" value={stats.chats} />
        <StatCard label="Messages" value={stats.messages} />
        <StatCard label="Secure chats" value={stats.e2e_chats} />
        <StatCard label="Encrypted messages" value={stats.encrypted_messages} />
      </div>

      <div style={styles.note}>
        🔒 Messages in end-to-end encrypted chats are stored as ciphertext and
        cannot be read from here — only counted.
      </div>

      <div className="row">
        <input
          className="field"
          style={{ flex: 1, minWidth: 200 }}
          placeholder="Search by username or email"
          value={search}
          onChange={(e) => {
            setPage(0);
            setSearch(e.target.value);
          }}
        />
        <button className="btn" onClick={() => setShowCreate(true)}>
          + New user
        </button>
      </div>

      {error && <div className="error-text">{error}</div>}
      {notice && <div style={styles.notice}>{notice}</div>}

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th className="hide-sm">Chats</th>
                <th className="hide-sm">Key</th>
                <th>Role</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} style={styles.centerCell}>
                    Loading…
                  </td>
                </tr>
              )}

              {!loading && users.length === 0 && (
                <tr>
                  <td colSpan={6} style={styles.centerCell}>
                    No users found
                  </td>
                </tr>
              )}

              {!loading &&
                users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.id}</strong>
                      {u.id === me && <span className="badge"> you</span>}
                    </td>
                    <td>{u.email}</td>
                    <td className="hide-sm">{u.chat_count}</td>
                    <td className="hide-sm">
                      {u.has_keys ? (
                        <span className="badge badge-secure">yes</span>
                      ) : (
                        <span className="muted">none</span>
                      )}
                    </td>
                    <td>
                      {u.is_admin ? (
                        <span className="badge">admin</span>
                      ) : (
                        <span className="muted">user</span>
                      )}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                        <button
                          className="btn btn-secondary"
                          style={styles.smallBtn}
                          onClick={() => setResetting(u)}
                        >
                          Reset
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={styles.smallBtn}
                          onClick={() => handleToggleAdmin(u)}
                          disabled={u.id === me}
                        >
                          {u.is_admin ? "Demote" : "Promote"}
                        </button>
                        <button
                          className="btn btn-danger"
                          style={styles.smallBtn}
                          onClick={() => handleDelete(u)}
                          disabled={u.id === me}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {pages > 1 && (
        <div className="row" style={{ justifyContent: "center" }}>
          <button
            className="btn btn-secondary"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            ← Previous
          </button>
          <span className="muted">
            Page {page + 1} of {pages}
          </span>
          <button
            className="btn btn-secondary"
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
            disabled={page >= pages - 1}
          >
            Next →
          </button>
        </div>
      )}

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={flash}
        />
      )}

      {resetting && (
        <ResetPasswordModal
          user={resetting}
          onClose={() => setResetting(null)}
          onDone={flash}
        />
      )}
    </div>
  );
}

const styles = {
  statGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 12,
  },
  stat: { textAlign: "center" },
  statValue: { fontSize: 26, fontWeight: 600 },
  note: {
    background: "var(--unread-bg)",
    borderRadius: 12,
    padding: 12,
    fontSize: 13,
  },
  notice: {
    background: "rgba(48,176,106,0.15)",
    color: "var(--secure)",
    borderRadius: 10,
    padding: "8px 12px",
    fontSize: 13,
  },
  warning: {
    background: "#fff4d6",
    color: "#5c4400",
    borderRadius: 10,
    padding: 12,
    fontSize: 13,
    lineHeight: 1.5,
  },
  smallBtn: { padding: "6px 10px", fontSize: 13, minHeight: 36 },
  centerCell: { textAlign: "center", padding: 24, color: "var(--subtext)" },
};
