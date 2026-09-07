import { useCallback, useEffect, useState } from "react";
import {
  approveRegistration,
  deleteRegistration,
  listRegistrations,
  rejectRegistration,
} from "../api/admin";
import Modal from "../components/Modal";

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
 * The signup queue.
 *
 * A request can sit here long enough for someone else to take the username or
 * email, so the server computes a `conflicts` list per row and this refuses to
 * offer Approve when it is non-empty — approving would fail on a constraint
 * and the reason would be a 409 rather than something actionable.
 */
export default function AdminRegistrations({ onNotice, onError }) {
  const [rows, setRows] = useState([]);
  const [pending, setPending] = useState(0);
  const [status, setStatus] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState("");

  // Per-row toggles for the approve step, so an admin can grant the number and
  // the admin role in the same click rather than as a follow-up edit.
  const [opts, setOpts] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listRegistrations(status);
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

  function optFor(id) {
    return opts[id] || { verifyPhone: true, makeAdmin: false };
  }

  function setOpt(id, patch) {
    setOpts((prev) => ({ ...prev, [id]: { ...optFor(id), ...patch } }));
  }

  async function approve(row) {
    setBusyId(row.id);
    try {
      const o = optFor(row.id);
      await approveRegistration(row.id, {
        verifyPhone: Boolean(row.phone) && o.verifyPhone,
        makeAdmin: o.makeAdmin,
      });
      onNotice(`Approved ${row.username}`);
      load();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function reject() {
    if (!rejecting) return;
    setBusyId(rejecting.id);
    try {
      await rejectRegistration(rejecting.id, reason);
      onNotice(`Rejected ${rejecting.username}`);
      setRejecting(null);
      setReason("");
      load();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(row) {
    if (!window.confirm(`Remove the record for "${row.username}" from the history?`)) return;
    try {
      await deleteRegistration(row.id);
      onNotice("Record removed");
      load();
    } catch (err) {
      onError(err.message);
    }
  }

  return (
    <div className="stack">
      {rejecting && (
        <Modal onClose={() => setRejecting(null)}>
        <div style={{ padding: 20 }} className="stack">
          <h3 style={{ margin: 0 }}>Reject "{rejecting.username}"</h3>
          <p className="muted" style={{ margin: 0, lineHeight: 1.7 }}>
            The reason is stored with the record for your own reference. It
            is not emailed to the applicant — there is no mail delivery
            configured.
          </p>
          <textarea
            className="field"
            rows={3}
            placeholder="Reason (optional)"
            style={{ resize: "vertical", fontFamily: "inherit" }}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setRejecting(null)}>
              Cancel
            </button>
            <button className="btn" onClick={reject} disabled={busyId === rejecting.id}>
              Reject
            </button>
          </div>
        </div>
        </Modal>
      )}

      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <strong style={{ flex: 1 }}>
          Registration requests
          {pending > 0 && <span className="badge" style={{ marginInlineStart: 8 }}>{pending} pending</span>}
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

      {loading && <div className="muted">Loading…</div>}
      {!loading && rows.length === 0 && (
        <div className="card muted" style={{ textAlign: "center" }}>
          Nothing here.
        </div>
      )}

      {rows.map((row) => {
        const o = optFor(row.id);
        const blocked = row.status === "pending" && row.conflicts.length > 0;

        return (
          <div key={row.id} className="card stack" style={{ gap: 10 }}>
            <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{row.username}</div>
                <div className="muted" style={{ fontSize: 13, lineHeight: 1.8 }}>
                  <div dir="ltr">✉️ {row.email}</div>
                  {row.phone && <div dir="ltr">📱 {row.phone}</div>}
                  <div>🕒 {formatDate(row.created_at)}</div>
                  <div>{row.has_keys ? "🔑 brought an encryption key" : "⚠️ no encryption key"}</div>
                </div>
              </div>
              <span className="badge" style={STATUS_STYLE[row.status]}>
                {row.status}
              </span>
            </div>

            {blocked && (
              <div className="error-text" style={{ fontSize: 13 }}>
                Cannot approve: the {row.conflicts.join(" and ")}{" "}
                {row.conflicts.length > 1 ? "are" : "is"} already taken by an
                existing account. Reject this request, or ask the applicant to
                submit a different one.
              </div>
            )}

            {row.status === "rejected" && row.reason && (
              <div className="muted" style={{ fontSize: 13 }}>
                Reason: {row.reason}
              </div>
            )}
            {row.decided_by && (
              <div className="muted" style={{ fontSize: 12 }}>
                Decided by {row.decided_by} on {formatDate(row.decided_at)}
              </div>
            )}

            {row.status === "pending" && (
              <>
                <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
                  {row.phone && (
                    <label style={styles.check}>
                      <input
                        type="checkbox"
                        checked={o.verifyPhone}
                        onChange={(e) => setOpt(row.id, { verifyPhone: e.target.checked })}
                      />
                      Verify their phone number now
                    </label>
                  )}
                  <label style={styles.check}>
                    <input
                      type="checkbox"
                      checked={o.makeAdmin}
                      onChange={(e) => setOpt(row.id, { makeAdmin: e.target.checked })}
                    />
                    Make administrator
                  </label>
                </div>

                <div className="row" style={{ gap: 8 }}>
                  <button
                    className="btn"
                    onClick={() => approve(row)}
                    disabled={busyId === row.id || blocked}
                  >
                    ✅ Approve
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setRejecting(row);
                      setReason("");
                    }}
                    disabled={busyId === row.id}
                  >
                    ✕ Reject
                  </button>
                </div>

                {row.phone && !o.verifyPhone && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    Their number will move to the “Phone numbers” queue instead
                    of being discarded.
                  </div>
                )}
              </>
            )}

            {row.status !== "pending" && (
              <div className="row">
                <button className="btn btn-secondary" style={styles.small} onClick={() => remove(row)}>
                  🗑 Remove record
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const styles = {
  check: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" },
  small: { fontSize: 12, padding: "5px 10px" },
};
