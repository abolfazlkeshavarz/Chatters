import { useCallback, useEffect, useState } from "react";
import {
  approvePhoneRequest,
  listPhoneRequests,
  rejectPhoneRequest,
  setUserPhone,
} from "../api/admin";

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

const STATUS_STYLE = {
  pending: { background: "#fef3c7", color: "#92400e" },
  approved: { background: "#dcfce7", color: "#166534" },
  rejected: { background: "#fee2e2", color: "#991b1b" },
};

/**
 * The phone-verification queue.
 *
 * A verified number is how strangers find an account, so this is the gate that
 * stops someone claiming a number that is not theirs. There is no SMS step —
 * approval here IS the verification, so check the number against whatever
 * out-of-band evidence you have before pressing it.
 */
export default function AdminPhones({ onNotice, onError }) {
  const [rows, setRows] = useState([]);
  const [pending, setPending] = useState(0);
  const [status, setStatus] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  // Direct assignment, for when a user cannot use the request form.
  const [manualUser, setManualUser] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualBusy, setManualBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listPhoneRequests(status);
      setRows(data.requests || []);
      setPending(data.pending || 0);
    } catch (err) {
      onError(err.message);
    } finally {
      setLoading(false);
    }
  }, [status, onError]);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(row) {
    setBusyId(row.id);
    try {
      await approvePhoneRequest(row.id);
      onNotice(`Verified ${row.phone} for ${row.user_id}`);
      load();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function reject(row) {
    const reason = window.prompt(`Reject ${row.user_id}'s number ${row.phone}?\n\nReason (optional):`);
    if (reason === null) return;
    setBusyId(row.id);
    try {
      await rejectPhoneRequest(row.id, reason);
      onNotice("Request rejected");
      load();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function assignManually() {
    if (!manualUser.trim()) {
      onError("Enter a username");
      return;
    }
    setManualBusy(true);
    try {
      await setUserPhone(manualUser.trim(), manualPhone.trim());
      onNotice(
        manualPhone.trim()
          ? `Set ${manualUser.trim()}'s number to ${manualPhone.trim()}`
          : `Cleared ${manualUser.trim()}'s number`
      );
      setManualUser("");
      setManualPhone("");
      load();
    } catch (err) {
      onError(err.message);
    } finally {
      setManualBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <strong style={{ flex: 1 }}>
          Phone numbers
          {pending > 0 && (
            <span className="badge" style={{ marginInlineStart: 8 }}>
              {pending} to verify
            </span>
          )}
        </strong>
        <select
          className="field"
          style={{ width: "auto" }}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </select>
        <button className="btn btn-secondary" onClick={load}>
          Refresh
        </button>
      </div>

      <div className="card stack" style={{ gap: 8 }}>
        <strong style={{ fontSize: 14 }}>Set a number directly</strong>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
          Assigns a verified number without the user having asked. Leave the
          number blank to clear theirs.
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input
            className="field"
            style={{ flex: "1 1 160px" }}
            placeholder="Username"
            value={manualUser}
            onChange={(e) => setManualUser(e.target.value)}
          />
          <input
            className="field"
            style={{ flex: "1 1 160px" }}
            dir="ltr"
            placeholder="+98… (blank to clear)"
            value={manualPhone}
            onChange={(e) => setManualPhone(e.target.value)}
          />
          <button className="btn" onClick={assignManually} disabled={manualBusy}>
            Apply
          </button>
        </div>
      </div>

      {loading && <div className="muted">Loading…</div>}
      {!loading && rows.length === 0 && (
        <div className="card muted" style={{ textAlign: "center" }}>
          Nothing here.
        </div>
      )}

      {rows.map((row) => (
        <div key={row.id} className="card stack" style={{ gap: 10 }}>
          <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{row.user_id}</div>
              <div className="muted" style={{ fontSize: 13, lineHeight: 1.8 }}>
                <div dir="ltr">
                  📱 requested: <strong>{row.phone}</strong>
                </div>
                <div dir="ltr">
                  current: {row.current_phone || "— none —"}
                </div>
                <div>🕒 {formatDate(row.created_at)}</div>
                {row.note && <div>📝 {row.note}</div>}
              </div>
            </div>
            <span className="badge" style={STATUS_STYLE[row.status]}>
              {row.status}
            </span>
          </div>

          {row.taken && row.status === "pending" && (
            <div className="error-text" style={{ fontSize: 13 }}>
              That number already belongs to a different account. Approving will
              fail — clear it from the other account first.
            </div>
          )}

          {row.decided_by && (
            <div className="muted" style={{ fontSize: 12 }}>
              Decided by {row.decided_by} on {formatDate(row.decided_at)}
            </div>
          )}

          {row.status === "pending" && (
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn"
                onClick={() => approve(row)}
                disabled={busyId === row.id || row.taken}
              >
                ✅ Verify
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => reject(row)}
                disabled={busyId === row.id}
              >
                ✕ Reject
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
