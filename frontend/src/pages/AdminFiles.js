import { useCallback, useEffect, useState } from "react";
import { listAdminFiles } from "../api/admin";
import { deleteFile, downloadFile, fetchFileURL } from "../api/files";
import ImageModal from "../components/ImageModal";

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

function kindOf(mime, filename) {
  const m = mime || "";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (/\.(jpe?g|png|gif|webp|avif)$/i.test(filename || "")) return "image";
  if (/\.(mp4|webm|mov|m4v)$/i.test(filename || "")) return "video";
  return "file";
}

/**
 * The moderator view of the shared library.
 *
 * Private items open without their password here — the server lets admins
 * through — which is the whole point: a password-protected upload is hidden
 * from other users, not from the person running the server.
 */
export default function AdminFiles({ onNotice, onError }) {
  const [files, setFiles] = useState([]);
  const [counts, setCounts] = useState({ public_count: 0, private_count: 0 });
  const [search, setSearch] = useState("");
  const [visibility, setVisibility] = useState("");
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [opening, setOpening] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAdminFiles({ search, visibility });
      setFiles(data.files || []);
      setCounts({
        public_count: data.public_count || 0,
        private_count: data.private_count || 0,
      });
    } catch (err) {
      onError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search, visibility, onError]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function open(file) {
    const kind = kindOf(file.mime_type, file.filename);
    if (kind !== "image" && kind !== "video") {
      await save(file);
      return;
    }
    setOpening(file.id);
    try {
      // No password: the server skips the check for administrators.
      const url = await fetchFileURL(file.id);
      setPreview({ url, filename: file.filename, kind });
    } catch (err) {
      onError(err.message);
    } finally {
      setOpening(null);
    }
  }

  async function save(file) {
    try {
      await downloadFile(file.id, file.filename);
    } catch (err) {
      onError(err.message);
    }
  }

  async function remove(file) {
    if (!window.confirm(`Delete "${file.title}" by ${file.owner || "unknown"}?`)) return;
    try {
      await deleteFile(file.id);
      onNotice("File deleted");
      load();
    } catch (err) {
      onError(err.message);
    }
  }

  const totalBytes = files.reduce((sum, f) => sum + (f.size_bytes || 0), 0);

  return (
    <div className="stack">
      {preview && (
        <ImageModal
          imageUrl={preview.url}
          filename={preview.filename}
          isVideo={preview.kind === "video"}
          onClose={() => {
            URL.revokeObjectURL(preview.url);
            setPreview(null);
          }}
          onDownload={() => {
            const a = document.createElement("a");
            a.href = preview.url;
            a.download = preview.filename || "file";
            document.body.appendChild(a);
            a.click();
            a.remove();
          }}
        />
      )}

      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ flex: "1 1 auto" }}>
          Public library
          <span className="badge" style={{ marginInlineStart: 8 }}>
            {counts.public_count} public
          </span>
          <span className="badge" style={{ marginInlineStart: 6 }}>
            {counts.private_count} private
          </span>
        </strong>
        <input
          className="field"
          style={{ flex: "1 1 180px" }}
          placeholder="Search title, filename or owner"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="field"
          style={{ width: "auto" }}
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
        >
          <option value="">All</option>
          <option value="public">Public only</option>
          <option value="private">Private only</option>
        </select>
      </div>

      <div className="muted" style={{ fontSize: 13 }}>
        Showing {files.length} items · {formatBytes(totalBytes)} on this page.
        Private items open here without their password.
      </div>

      {loading && <div className="muted">Loading…</div>}

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Owner</th>
                <th>Type</th>
                <th>Size</th>
                <th>Visibility</th>
                <th>Views</th>
                <th>Uploaded</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id}>
                  <td style={{ maxWidth: 240, whiteSpace: "normal" }}>
                    <div style={{ fontWeight: 600 }}>{f.title}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {f.filename}
                    </div>
                  </td>
                  <td>{f.owner || "—"}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {f.mime_type}
                  </td>
                  <td>{formatBytes(f.size_bytes)}</td>
                  <td>
                    {f.visibility === "private" ? (
                      <span className="badge" style={{ background: "#fef3c7", color: "#92400e" }}>
                        🔒 private
                      </span>
                    ) : (
                      <span className="badge">🌐 public</span>
                    )}
                  </td>
                  <td>{f.download_count}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {formatDate(f.created_at)}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <button
                        className="btn btn-secondary"
                        style={styles.small}
                        onClick={() => open(f)}
                        disabled={opening === f.id}
                      >
                        {opening === f.id ? "…" : "👁"}
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={styles.small}
                        onClick={() => save(f)}
                      >
                        📥
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={styles.small}
                        onClick={() => remove(f)}
                      >
                        🗑
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && files.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted" style={{ textAlign: "center", padding: 24 }}>
                    Nothing uploaded yet.
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

const styles = {
  small: { fontSize: 12, padding: "4px 8px" },
};
