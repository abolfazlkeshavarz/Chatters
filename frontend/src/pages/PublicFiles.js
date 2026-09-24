import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

// Images up to this size get an inline thumbnail. There is no server-side
// thumbnail endpoint, so a "thumbnail" is the whole file; anything bigger is
// left as an icon until the user taps it, or a phone would download tens of
// megabytes just to draw a list.
const THUMB_MAX_BYTES = 4 * 1024 * 1024;

/** Asks for a private file's password, then hands it back to the caller. */
function PasswordDialog({ title, onClose, onSubmit }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!password) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(password);
    } catch (err) {
      setError(err.message || "رمز نادرست است");
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div style={{ padding: 20 }} className="stack">
        <h3 style={{ margin: 0 }}>🔒 این فایل خصوصی است</h3>
        <div className="muted" style={{ wordBreak: "break-word" }}>
          {title}
        </div>
        <input
          className="field"
          type="password"
          autoFocus
          placeholder="رمز فایل"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {error && <div className="error-text">{error}</div>}
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button className="btn btn-secondary" onClick={onClose}>
            انصراف
          </button>
          <button className="btn" onClick={submit} disabled={busy || !password}>
            {busy ? "…" : "باز کن"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * One entry in the library, laid out as a compact row: a small thumbnail, the
 * details, and an always-visible action bar underneath.
 *
 * Nothing heavy happens until it has to. A thumbnail is fetched only once the
 * row scrolls into view (and only for modest images); full-size images, video
 * and audio are fetched when the user taps the row and shown in a full-screen
 * viewer. Fetching every file on mount — the old behaviour — meant opening
 * the page downloaded the entire library at once.
 *
 * A locked item stays locked until the password is verified against the
 * server: guessing inside an <img> tag can only ever report "broken", so the
 * password is checked with an explicit call first and only then are the bytes
 * fetched.
 */
function FileRow({ file, me, onDeleted, onEdit }) {
  const kind = kindOf(file.mime_type, file.filename);
  const locked = file.visibility === "private" && !file.can_open;
  const canView = kind === "image" || kind === "video" || kind === "audio";
  const wantsThumb =
    kind === "image" && file.size_bytes > 0 && file.size_bytes <= THUMB_MAX_BYTES;

  const [unlocked, setUnlocked] = useState(!locked);
  const [password, setPassword] = useState("");
  const [asking, setAsking] = useState(false);
  const [thumb, setThumb] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rowRef = useRef(null);

  // Object URLs are owned by this row; leaking them would pin the whole file
  // in memory for as long as the page lives.
  const thumbRef = useRef(null);
  useEffect(() => {
    thumbRef.current = thumb;
  }, [thumb]);
  useEffect(
    () => () => {
      if (thumbRef.current) URL.revokeObjectURL(thumbRef.current);
    },
    []
  );

  // Lazy thumbnail: wait until the row is actually near the screen.
  useEffect(() => {
    if (!wantsThumb || !unlocked || thumb) return undefined;

    let cancelled = false;
    const fetchThumb = async () => {
      try {
        const u = await fetchFileURL(file.id, password);
        if (cancelled) URL.revokeObjectURL(u);
        else setThumb(u);
      } catch {
        /* the icon stays; tapping the row reports the real error */
      }
    };

    const el = rowRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      fetchThumb();
      return () => {
        cancelled = true;
      };
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          fetchThumb();
        }
      },
      { rootMargin: "240px 0px" }
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
    // password is only ever set as the file becomes unlocked
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsThumb, unlocked, file.id]);

  async function save(pw = password) {
    setError("");
    try {
      await downloadFile(file.id, file.filename, pw);
    } catch (err) {
      setError(err.message || "دانلود ناموفق بود");
    }
  }

  async function show(pw) {
    setBusy(true);
    setError("");
    try {
      const url = kind === "image" && thumb ? thumb : await fetchFileURL(file.id, pw);
      setViewer({ url, own: url !== thumb });
    } catch (err) {
      setError(err.message || "خطا در دریافت فایل");
    } finally {
      setBusy(false);
    }
  }

  function closeViewer() {
    if (viewer && viewer.own) URL.revokeObjectURL(viewer.url);
    setViewer(null);
  }

  function open() {
    if (busy) return;
    if (!unlocked) {
      setAsking(true);
      return;
    }
    if (canView) show(password);
    else save();
  }

  async function submitPassword(pw) {
    await unlockFile(file.id, pw);
    setPassword(pw);
    setUnlocked(true);
    setAsking(false);
    if (canView) await show(pw);
    else await save(pw);
  }

  async function remove() {
    if (!window.confirm(`«${file.title}» حذف شود؟`)) return;
    try {
      await deleteFile(file.id);
      onDeleted(file.id);
    } catch (err) {
      setError(err.message);
    }
  }

  const mine = file.is_owner || file.owner === me;

  return (
    <div className="card file-row" ref={rowRef}>
      {asking && (
        <PasswordDialog
          title={file.title}
          onClose={() => setAsking(false)}
          onSubmit={submitPassword}
        />
      )}
      {/* Portalled for the same reason Modal is: position: fixed is anchored
          to the nearest transformed ancestor, and the page-transition
          animation puts one on .app-content. */}
      {viewer &&
        createPortal(
          <ImageModal
            imageUrl={viewer.url}
            filename={file.title || file.filename}
            isVideo={kind === "video"}
            isAudio={kind === "audio"}
            onClose={closeViewer}
            onDownload={() => save()}
          />,
          document.body
        )}

      <button
        type="button"
        className="file-main"
        onClick={open}
        aria-label={file.title}
      >
        <span className="file-thumb">
          {thumb ? (
            <img src={thumb} alt="" />
          ) : busy ? (
            <span className="spinner" />
          ) : (
            <span className="file-thumb-icon">{ICONS[kind]}</span>
          )}
          {!unlocked && <span className="file-badge">🔒</span>}
          {unlocked && kind === "video" && <span className="file-badge">▶</span>}
        </span>

        <span className="file-info">
          <span className="file-title">
            {file.visibility === "private" && unlocked && <span>🔒 </span>}
            {file.title}
          </span>
          {file.description && <span className="file-desc">{file.description}</span>}
          <span className="file-meta">
            {[file.owner || "ناشناس", formatBytes(file.size_bytes), formatDate(file.created_at)]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
      </button>

      {error && <div className="error-text file-error">{error}</div>}

      <div className="file-actions">
        <button type="button" className="file-action" onClick={open}>
          {canView ? "👁 نمایش" : "📥 دانلود"}
        </button>
        {canView && (
          <button
            type="button"
            className="file-action"
            onClick={() => (unlocked ? save() : setAsking(true))}
          >
            📥 دانلود
          </button>
        )}
        {mine && (
          <>
            <button type="button" className="file-action" onClick={() => onEdit(file)}>
              ✏️ ویرایش
            </button>
            <button
              type="button"
              className="file-action file-action-danger"
              onClick={remove}
            >
              🗑 حذف
            </button>
          </>
        )}
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

const PAGE_SIZE = 40;

/**
 * The shared library: anything anyone posts, public or password-protected.
 * Separate from chats on purpose — this is a noticeboard, not a conversation.
 */
export default function PublicFiles() {
  const me = localStorage.getItem("username");

  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [mine, setMine] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(null);

  // Guards against a slow response for an old search overwriting a newer one.
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const req = ++requestRef.current;
    setLoading(true);
    try {
      const data = await listFiles({ search, mine, limit: PAGE_SIZE, offset: 0 });
      if (req !== requestRef.current) return;
      const list = data.files || [];
      setFiles(list);
      setHasMore(list.length === PAGE_SIZE);
      setError("");
    } catch (err) {
      if (req !== requestRef.current) return;
      setError(err.message || "خطا در دریافت فهرست");
    } finally {
      if (req === requestRef.current) setLoading(false);
    }
  }, [search, mine]);

  async function loadMore() {
    const req = requestRef.current;
    setLoadingMore(true);
    try {
      const data = await listFiles({
        search,
        mine,
        limit: PAGE_SIZE,
        offset: files.length,
      });
      if (req !== requestRef.current) return;
      const next = data.files || [];
      setFiles((prev) => {
        const seen = new Set(prev.map((f) => f.id));
        return [...prev, ...next.filter((f) => !seen.has(f.id))];
      });
      setHasMore(next.length === PAGE_SIZE);
    } catch (err) {
      setError(err.message || "خطا در دریافت فهرست");
    } finally {
      setLoadingMore(false);
    }
  }

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
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>فایل‌ها و رسانه‌ها</h2>
          <div className="muted">فضای اشتراکی همه کاربران</div>
        </div>
        <button className="btn" onClick={() => setUploading(true)}>
          ＋ بارگذاری
        </button>
      </div>

      <div className="files-toolbar">
        <input
          className="field"
          type="search"
          enterKeyHint="search"
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

      {error && <div className="error-text files-error">{error}</div>}

      <div className="scroll-area files-grid">
        {loading && files.length === 0 && (
          <div className="files-empty">در حال بارگذاری…</div>
        )}
        {!loading && files.length === 0 && (
          <div className="files-empty">هنوز فایلی بارگذاری نشده است.</div>
        )}
        {files.map((f) => (
          <FileRow
            key={f.id}
            file={f}
            me={me}
            onEdit={setEditing}
            onDeleted={(id) => setFiles((prev) => prev.filter((x) => x.id !== id))}
          />
        ))}
        {hasMore && (
          <button
            className="btn btn-secondary files-more"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "…" : "نمایش موارد بیشتر"}
          </button>
        )}
      </div>
    </div>
  );
}
