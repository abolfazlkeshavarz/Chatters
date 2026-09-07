import { useEffect, useState } from "react";
import { getUserDetail } from "../api/admin";
import Avatar from "./Avatar";

function formatDate(ts) {
  if (!ts) return "never";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "—";
  }
}

function Row({ label, value }) {
  return (
    <div style={styles.row}>
      <span className="muted" style={styles.label}>
        {label}
      </span>
      <span style={styles.value}>{value}</span>
    </div>
  );
}

/**
 * Everything the panel knows about one account.
 *
 * The profile photo renders even when its owner set it to "contacts only" —
 * the avatar endpoint lets administrators through, and this is the view where
 * that matters.
 */
export default function AdminUserDetail({ userId, onClose }) {
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getUserDetail(userId)
      .then((d) => setUser(d.user))
      .catch((err) => setError(err.message));
  }, [userId]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: 20 }} className="stack">
          <div className="row" style={{ alignItems: "center", gap: 14 }}>
            <Avatar userId={userId} size={64} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 style={{ margin: 0 }}>{userId}</h3>
              {user && (
                <div className="muted" style={{ fontSize: 13 }}>
                  {user.is_admin ? "🛠️ Administrator" : "Regular user"}
                </div>
              )}
            </div>
          </div>

          {error && <div className="error-text">{error}</div>}
          {!user && !error && <div className="muted">Loading…</div>}

          {user && (
            <>
              <div className="card stack" style={{ gap: 2 }}>
                <Row label="Email" value={<span dir="ltr">{user.email}</span>} />
                <Row
                  label="Phone"
                  value={
                    user.phone ? (
                      <span dir="ltr">
                        {user.phone}{" "}
                        {user.phone_verified ? "✅ verified" : "⏳ unverified"}
                      </span>
                    ) : (
                      "— none —"
                    )
                  }
                />
                {user.pending_phone && (
                  <Row
                    label="Pending phone"
                    value={<span dir="ltr">{user.pending_phone} (awaiting review)</span>}
                  />
                )}
                <Row label="Registered" value={formatDate(user.created_at)} />
                <Row label="Last seen" value={formatDate(user.last_seen_at)} />
                <Row
                  label="Encryption key"
                  value={user.has_keys ? "✅ present" : "— none —"}
                />
                <Row
                  label="Profile photo"
                  value={
                    user.has_avatar
                      ? `set · visibility: ${user.avatar_visibility}`
                      : "— none —"
                  }
                />
                <Row label="Sessions invalidated" value={user.token_version} />
                <Row label="Push devices" value={user.push_device_count} />
              </div>

              <div style={styles.statGrid}>
                <Stat label="Chats" value={user.chat_count} />
                <Stat label="Secret chats" value={user.secret_chat_count} />
                <Stat label="Messages" value={user.message_count} />
                <Stat label="Attachments" value={user.media_count} />
                <Stat label="Contacts" value={user.contact_count} />
                <Stat label="Library items" value={user.public_file_count} />
              </div>

              {user.contacts.length > 0 && (
                <div className="stack" style={{ gap: 6 }}>
                  <span className="muted" style={{ fontSize: 13 }}>
                    Contacts
                  </span>
                  <div className="row" style={{ gap: 5, flexWrap: "wrap" }}>
                    {user.contacts.map((c) => (
                      <span key={c} className="badge">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="card" style={styles.stat}>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value ?? 0}</div>
      <div className="muted" style={{ fontSize: 11 }}>
        {label}
      </div>
    </div>
  );
}

const styles = {
  row: {
    display: "flex",
    gap: 10,
    padding: "6px 0",
    borderBottom: "1px solid var(--border)",
    fontSize: 13,
  },
  label: { minWidth: 140, flexShrink: 0 },
  value: { flex: 1, wordBreak: "break-word" },
  statGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))",
    gap: 8,
  },
  stat: { padding: 10, textAlign: "center" },
};
