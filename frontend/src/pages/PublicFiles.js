import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteFile,
  downloadFile,
  fetchFileURL,
  listFiles,
  unlockFile,
  updateFile,
  uploadFile,
} from "../api/files";
import ImageModal from "../components/ImageModal";
import Modal from "../components/Modal";

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "";
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
    return new Date(ts).toLocaleDateString("fa-IR", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function kindOf(mime, filename) {
  const m = mime || "";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  const name = filename || "";
  if (/\.(jpe?g|png|gif|webp|avif|bmp)$/i.test(name)) return "image";
  if (/\.(mp4|webm|mov|m4v|mkv)$/i.test(name)) return "video";
  if (/\.(mp3|wav|ogg|m4a)$/i.test(name)) return "audio";
  return "file";
}

const ICONS = { image: "🖼️", video: "🎬", audio: "🎵", file: "📄" };

/**
 * One entry in the library.
 *
 * A locked item stays locked until the password is verified against the
 * server: guessing inside an <img> tag can only ever report "broken", so the
 * password is checked with an explicit call first and only then are the bytes
 * fetched.
 */
function FileCard({ file, me, onDeleted, onEdit }) {
  const kind = kindOf(file.mime_type, file.filename);
  const locked = file.visibility === "private" && !file.can_open;

  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(!locked);
  const [preview, setPreview] = useState(null);

  // Object URLs are owned by this card; leaking them would pin the whole file
  // in memory for as long as the page lives.
  const urlRef = useRef(null);
  useEffect(() => {
    urlRef.current = url;
  }, [url]);
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    []
  );

  const canPreview = kind === "image" || kind === "video" || kind === "audio";

  const load = useCallback(
    async (pw) => {
      setLoading(true);
      setError("");
      try {
        const u = await fetchFileURL(file.id, pw);
        setUrl(u);
      } catch (err) {
        setError(err.message || "خطا در دریافت فایل");
      } finally {
        setLoading(false);
      }
    },
    [file.id]
  );

  // Public (or owned) media renders itself; locked media waits for a password.
  useEffect(() => {
    if (unlocked && canPreview && !url && !loading && !error) load(password);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  async function submitPassword() {
    setLoading(true);
    setError("");
    try {
      await unlockFile(file.id, password);
      setUnlocked(true);
      if (canPreview) await load(password);
    } catch (err) {
      setError(err.message || "رمز نادرست است");
      setLoading(false);
    }
  }

  async function save() {
    try {
      await downloadFile(file.id, file.filename, unlocked ? password : "");
    } catch (err) {
      setError(err.message || "دانلود ناموفق بود");
    }
  }

  const mine = file.is_owner || file.owner === me;

  return (
    <div className="card card-interactive" style={styles.card}>
      {preview && (
        <ImageModal
          imageUrl={preview.url}
          filename={preview.filename}
          isVideo={preview.kind === "video"}
          onClose={() => setPreview(null)}
          onDownload={save}
        />
      )}

      <div style={styles.media}>
        {!unlocked && (
          <div style={styles.locked}>
            <div style={{ fontSize: 34 }}>🔒</div>
            <div style={styles.lockedText}>این فایل خصوصی است</div>
            <div className="row" style={{ gap: 6, width: "100%" }}>
              <input
                className="field"
                type="password"
                placeholder="رمز فایل"
                style={{ flex: 1, fontSize: 13 }}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitPassword()}
              />
              <button className="btn" onClick={submitPassword} disabled={loading}>
                {loading ? "…" : "باز کن"}
              </button>
            </div>
          </div>
        )}

        {unlocked && canPreview && url && kind === "image" && (
          <img
            src={url}
            alt={file.title}
            style={styles.thumb}
            onClick={() => setPreview({ url, filename: file.filename, kind })}
          />
        )}
        {unlocked && canPreview && url && kind === "video" && (
          <video src={url} style={styles.thumb} controls preload="metadata" />
        )}
        {unlocked && canPreview && url && kind === "audio" && (
          <div style={styles.audioWrap}>
            <div style={{ fontSize: 34 }}>🎵</div>
            <audio src={url} controls style={{ width: "100%" }} />
          </div>
        )}
        {unlocked && canPreview && !url && (
          <div style={styles.placeholder}>
            {loading ? <span className="spinner" /> : <span>{ICONS[kind]}</span>}
          </div>
        )}
        {unlocked && !canPreview && (
          <div style={styles.placeholder}>
            <span style={{ fontSize: 40 }}>{ICONS.file}</span>
          </div>
        )}
      </div>

      <div style={styles.body}>
        <div style={styles.title} title={file.title}>
          {file.visibility === "private" && <span title="خصوصی">🔒 </span>}
          {file.title}
        </div>

        {file.description && <div style={styles.desc}>{file.description}</div>}

        <div style={styles.meta}>
          <span>{file.owner || "ناشناس"}</span>
          <span> · </span>
          <span>{formatBytes(file.size_bytes)}</span>
          <span> · </span>
          <span>{formatDate(file.created_at)}</span>
        </div>

        {error && <div className="error-text" style={{ fontSize: 12 }}>{error}</div>}

        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <button className="btn btn-secondary" style={styles.smallBtn} onClick={save}>
            📥 دانلود
          </button>
          {mine && (
            <>
              <button
                className="btn btn-secondary"
                style={styles.smallBtn}
                onClick={() => onEdit(file)}
              >
                ✏️ ویرایش
              </button>
              <button
                className="btn btn-secondary"
                style={styles.smallBtn}
                onClick={async () => {
                  if (!window.confirm(`«${file.title}» حذف شود؟`)) return;
                  try {
                    await deleteFile(file.id);
                    onDeleted(file.id);
                  } catch (err) {
                    setError(err.message);
                  }
                }}
              >
                🗑 حذف
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function UploadModal({ onClose, onUploaded }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [password, setPassword] = useState("");
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");

  async function submit() {
    if (!file) {
      setError("یک فایل انتخاب کنید");
      return;
    }
    if (visibility === "private" && password.length < 8) {
      setError("برای فایل خصوصی رمزی حداقل ۸ کاراکتری بگذارید");
      return;
    }

    setError("");
    setProgress(0);
    try {
      const { promise } = uploadFile(
        { file, title, description, visibility, password },
        { onProgress: setProgress }
      );
      await promise;
      onUploaded();
      onClose();
    } catch (err) {
      setError(err.message || "بارگذاری ناموفق بود");
      setProgress(null);
    }
  }

  return (
    <Modal onClose={onClose}>
    <div style={{ padding: 20 }} className="stack">
      <h3 style={{ margin: 0 }}>بارگذاری فایل یا رسانه</h3>

      <input
        type="file"
        className="field"
        onChange={(e) => {
          const f = e.target.files?.[0] || null;
          setFile(f);
          if (f && !title) setTitle(f.name);
        }}
      />

      <input
        className="field"
        placeholder="عنوان"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <textarea
        className="field"
        rows={3}
        placeholder="توضیحات (اختیاری)"
        style={{ resize: "vertical", fontFamily: "inherit" }}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <div className="row" style={{ gap: 6 }}>
        {[
          { id: "public", label: "🌐 عمومی" },
          { id: "private", label: "🔒 خصوصی" },
        ].map((v) => (
          <button
            key={v.id}
            className={visibility === v.id ? "btn" : "btn btn-secondary"}
            style={{ flex: 1 }}
            onClick={() => setVisibility(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>

      {visibility === "private" && (
        <>
          <input
            className="field"
            type="password"
            placeholder="رمز فایل (حداقل ۸ کاراکتر)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
            این رمز را خودتان به کسانی که باید فایل را ببینند بدهید. رمز
            قابل بازیابی نیست.
          </div>
        </>
      )}

      {progress !== null && (
        <div className="muted">در حال بارگذاری… {progress}%</div>
      )}
      {error && <div className="error-text">{error}</div>}

      <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button className="btn btn-secondary" onClick={onClose}>
          انصراف
        </button>
        <button className="btn" onClick={submit} disabled={progress !== null}>
          بارگذاری
        </button>
      </div>
    </div>
    </Modal>
  );
}

function EditModal({ file, onClose, onSaved }) {
  const [title, setTitle] = useState(file.title);
  const [description, setDescription] = useState(file.description);
  const [visibility, setVisibility] = useState(file.visibility);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    if (visibility === "private" && file.visibility !== "private" && password.length < 8) {
      setError("برای خصوصی کردن، رمزی حداقل ۸ کاراکتری بگذارید");
      return;
    }
    try {
      await updateFile(file.id, {
        title,
        description,
        visibility,
        ...(password ? { password } : {}),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal onClose={onClose}>
    <div style={{ padding: 20 }} className="stack">
      <h3 style={{ margin: 0 }}>ویرایش</h3>

      <input
        className="field"
        placeholder="عنوان"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="field"
        rows={3}
        style={{ resize: "vertical", fontFamily: "inherit" }}
        placeholder="توضیحات"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <div className="row" style={{ gap: 6 }}>
        {[
          { id: "public", label: "🌐 عمومی" },
          { id: "private", label: "🔒 خصوصی" },
        ].map((v) => (
          <button
            key={v.id}
            className={visibility === v.id ? "btn" : "btn btn-secondary"}
            style={{ flex: 1 }}
            onClick={() => setVisibility(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>

      {visibility === "private" && (
        <input
          className="field"
          type="password"
          placeholder={
            file.visibility === "private"
              ? "رمز جدید (خالی = بدون تغییر)"
              : "رمز فایل (حداقل ۸ کاراکتر)"
          }
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      )}

      {error && <div className="error-text">{error}</div>}

      <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button className="btn btn-secondary" onClick={onClose}>
          انصراف
        </button>
        <button className="btn" onClick={submit}>
          ذخیره
        </button>
      </div>
    </div>
    </Modal>
  );
}

/**
 * The shared library: anything anyone posts, public or password-protected.
 * Separate from chats on purpose — this is a noticeboard, not a conversation.
 */
export default function PublicFiles() {
  const me = localStorage.getItem("username");

  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [mine, setMine] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listFiles({ search, mine });
      setFiles(data.files || []);
      setError("");
    } catch (err) {
      setError(err.message || "خطا در دریافت فهرست");
    } finally {
      setLoading(false);
    }
  }, [search, mine]);

  // Debounced so typing in the search box does not fire a request per keypress.
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="pane">
      {uploading && (
        <UploadModal onClose={() => setUploading(false)} onUploaded={load} />
      )}
      {editing && (
        <EditModal file={editing} onClose={() => setEditing(null)} onSaved={load} />
      )}

      <div className="app-header">
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>فایل‌ها و رسانه‌ها</h2>
          <div className="muted">فضای اشتراکی همه کاربران</div>
        </div>
        <button className="btn" onClick={() => setUploading(true)}>
          ＋ بارگذاری
        </button>
      </div>

      <div style={{ padding: "10px 12px", display: "flex", gap: 8 }}>
        <input
          className="field"
          style={{ flex: 1 }}
          placeholder="جستجو در عنوان، نام فایل یا کاربر…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className={mine ? "btn" : "btn btn-secondary"}
          onClick={() => setMine((v) => !v)}
          title="فقط فایل‌های من"
        >
          {mine ? "📂 من" : "📁 همه"}
        </button>
      </div>

      {error && (
        <div className="error-text" style={{ padding: "0 12px" }}>
          {error}
        </div>
      )}

      <div className="scroll-area stagger" style={styles.grid}>
        {loading && <div style={styles.empty}>در حال بارگذاری…</div>}
        {!loading && files.length === 0 && (
          <div style={styles.empty}>هنوز فایلی بارگذاری نشده است.</div>
        )}
        {files.map((f) => (
          <FileCard
            key={f.id}
            file={f}
            me={me}
            onEdit={setEditing}
            onDeleted={(id) => setFiles((prev) => prev.filter((x) => x.id !== id))}
          />
        ))}
      </div>
    </div>
  );
}

const styles = {
  grid: {
    padding: 12,
    display: "grid",
    gap: 12,
    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
    alignContent: "start",
  },
  empty: {
    gridColumn: "1 / -1",
    textAlign: "center",
    color: "var(--subtext)",
    padding: 32,
  },
  card: { padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" },
  media: {
    position: "relative",
    background: "var(--bubble-in)",
    minHeight: 150,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  thumb: {
    display: "block",
    width: "100%",
    maxHeight: 220,
    objectFit: "cover",
    cursor: "pointer",
    background: "#000",
  },
  placeholder: {
    width: "100%",
    minHeight: 150,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 40,
  },
  audioWrap: {
    width: "100%",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
  },
  locked: {
    width: "100%",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
  },
  lockedText: { fontSize: 13, color: "var(--subtext)" },
  body: { padding: 12, display: "flex", flexDirection: "column", gap: 6, flex: 1 },
  title: {
    fontWeight: 600,
    fontSize: 14,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  desc: {
    fontSize: 12,
    color: "var(--subtext)",
    lineHeight: 1.6,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  meta: { fontSize: 11, color: "var(--subtext)" },
  smallBtn: { fontSize: 12, padding: "5px 10px" },
};
