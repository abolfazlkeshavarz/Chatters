import { useCallback, useEffect, useState } from "react";
import { getAuditLog } from "../api/admin";

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

// Grouped by the prefix the handlers use, so filtering matches how actions are
// actually named server-side rather than a second vocabulary invented here.
const FILTERS = [
  { id: "", label: "All" },
  { id: "registration", label: "Registrations" },
  { id: "phone", label: "Phone numbers" },
  { id: "announcement", label: "Announcements" },
  { id: "media", label: "Media access" },
  { id: "public_file", label: "Library" },
];

const ICONS = {
  "registration.approve": "✅",
  "registration.reject": "✕",
  "registration.delete": "🗑",
  "phone.approve": "📱",
  "phone.reject": "✕",
  "phone.set": "📱",
  "phone.clear": "🚫",
  "announcement.create": "📢",
  "announcement.update": "🔁",
  "announcement.delete": "🗑",
  "media.view": "👁",
  "public_file.delete": "🗑",
};

/**
 * The record of privileged actions — who approved an account, who opened
 * someone's attachment, who deleted what.
 *
 * Media views are logged deliberately: an admin being able to open any
 * attachment is a real power, and a power with no trail is one nobody can
 * check afterwards.
 */
export default function AdminAudit({ onError }) {
  const [entries, setEntries] = useState([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAuditLog({ action: filter, limit: 200 });
      setEntries(data.entries || []);
    } catch (err) {
      onError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filter, onError]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="stack">
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ flex: 1 }}>Audit log</strong>
        <button className="btn btn-secondary" onClick={load}>
          Refresh
        </button>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={filter === f.id ? "btn" : "btn btn-secondary"}
            style={{ fontSize: 12, padding: "5px 12px" }}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && <div className="muted">Loading…</div>}

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Admin</th>
                <th>Action</th>
                <th>Target</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {formatDate(e.created_at)}
                  </td>
                  <td>{e.actor || "—"}</td>
                  <td>
                    <span style={{ marginInlineEnd: 6 }}>{ICONS[e.action] || "•"}</span>
                    {e.action}
                  </td>
                  <td>{e.target || "—"}</td>
                  <td
                    className="muted"
                    style={{ fontSize: 12, maxWidth: 260, whiteSpace: "normal" }}
                  >
                    {e.detail || "—"}
                  </td>
                </tr>
              ))}
              {!loading && entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 24 }}>
                    Nothing recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
