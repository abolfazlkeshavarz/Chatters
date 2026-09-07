import { useEffect, useRef, useState } from "react";
import { getMediaURL, downloadMedia } from "../api/media";
import ImageModal from "./ImageModal";

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString("fa-IR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function isMedia(m) {
  return m.type === "media" || m.has_file || Boolean(m.filename);
}

function isSystem(m) {
  return m.type === "system" || m.is_system || (!m.from && !m.is_encrypted);
}

/** "self-destructs in 4s" / "…in 3m" countdown for a message with an expiry. */
function SelfDestructBadge({ expiresAt, now }) {
  const remaining = Math.max(0, new Date(expiresAt).getTime() - now);
  if (remaining <= 0) return null;
  const secs = Math.ceil(remaining / 1000);
  const label =
    secs < 60
      ? `${secs}s`
      : secs < 3600
      ? `${Math.ceil(secs / 60)}m`
      : secs < 86400
      ? `${Math.ceil(secs / 3600)}h`
      : `${Math.ceil(secs / 86400)}d`;
  return <span title="مدتی پس از ارسال حذف می‌شود"> · 🔥 {label}</span>;
}

/** image | video | file — from the mime type, with a filename-extension fallback. */
function mediaKind(m) {
  const mime = m.mime_type || "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  const name = m.filename || m.content || "";
  if (/\.(jpe?g|png|gif|bmp|webp|avif|heic)$/i.test(name)) return "image";
  if (/\.(mp4|webm|mov|m4v|ogv|mkv)$/i.test(name)) return "video";
  return "file";
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/** Circular upload/download progress indicator drawn over a thumbnail. */
function ProgressRing({ value }) {
  const r = 17;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, value || 0));
  return (
    <svg width="42" height="42" viewBox="0 0 42 42" aria-hidden="true">
      <circle cx="21" cy="21" r={r} fill="rgba(0,0,0,0.45)" stroke="rgba(255,255,255,0.3)" strokeWidth="3" />
      <circle
        cx="21"
        cy="21"
        r={r}
        fill="none"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - clamped / 100)}
        transform="rotate(-90 21 21)"
      />
      <text x="21" y="24.5" textAnchor="middle" fontSize="9" fill="#fff">
        {Math.round(clamped)}
      </text>
    </svg>
  );
}

/**
 * One attachment in a bubble. Images load themselves (they are small); video
 * loads on tap so a scroll-back does not pull every clip down at once. An
 * upload still in flight shows its own local preview with a progress ring.
 */
function MediaAttachment({ message, onOpen, onDownload, onRetry }) {
  const kind = mediaKind(message);
  const label = message.filename || message.content || "attachment";
  const hasServerId =
    typeof message.id === "number" && !message.pending && !message.failed;

  const [url, setUrl] = useState(message._localURL || null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [videoOpen, setVideoOpen] = useState(
    kind === "video" && Boolean(message._localURL)
  );

  useEffect(() => {
    if (message._localURL) {
      setUrl(message._localURL);
      return undefined;
    }
    // Only images auto-fetch; video waits for a tap.
    if (kind !== "image" || !hasServerId) return undefined;

    let alive = true;
    setLoading(true);
    setFailed(false);
    getMediaURL(message.id)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [message.id, message._localURL, kind, hasServerId]);

  async function loadVideo() {
    if (url) {
      setVideoOpen(true);
      return;
    }
    if (!hasServerId) return;
    setLoading(true);
    setFailed(false);
    try {
      setUrl(await getMediaURL(message.id));
      setVideoOpen(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  if (message.failed) {
    return (
      <div style={styles.mediaFailed}>
        <span>⚠️ بارگذاری ناموفق بود — {label}</span>
        {onRetry && (
          <button style={styles.retryBtn} onClick={() => onRetry(message)}>
            تلاش دوباره
          </button>
        )}
      </div>
    );
  }

  if (kind === "image") {
    return (
      <div style={styles.mediaWrap}>
        {url ? (
          <img
            src={url}
            alt={label}
            style={styles.mediaThumb}
            onClick={() => onOpen({ url, filename: label, kind })}
          />
        ) : (
          <div style={styles.mediaPlaceholder}>
            {failed ? "🖼️ بارگذاری ناموفق بود" : <span className="spinner" />}
          </div>
        )}
        {message.pending && (
          <div style={styles.mediaOverlay}>
            <ProgressRing value={message.progress} />
          </div>
        )}
      </div>
    );
  }

  if (kind === "video") {
    return (
      <div style={styles.mediaWrap}>
        {videoOpen && url ? (
          <video
            src={url}
            style={styles.mediaThumb}
            controls
            playsInline
            preload="metadata"
            autoPlay={!message.pending}
            muted={message.pending}
          />
        ) : (
          <button style={styles.mediaPlaceholder} onClick={loadVideo}>
            {loading ? (
              <span className="spinner" />
            ) : (
              <>
                <span style={styles.playGlyph}>▶</span>
                <span style={styles.mediaHint}>
                  {failed ? "برای تلاش دوباره ضربه بزنید" : "ویدیو"}
                </span>
              </>
            )}
          </button>
        )}
        {message.pending && (
          <div style={styles.mediaOverlay}>
            <ProgressRing value={message.progress} />
          </div>
        )}
        {videoOpen && url && (
          <button
            style={styles.expandBtn}
            aria-label="تمام‌صفحه"
            onClick={() => onOpen({ url, filename: label, kind })}
          >
            ⤢
          </button>
        )}
      </div>
    );
  }

  // Generic file.
  return (
    <div style={styles.fileRow}>
      <button
        style={styles.fileButton}
        onClick={() => (message.pending ? null : onDownload(message))}
        disabled={message.pending}
      >
        📎 <span>{label}</span>
        {message._size ? (
          <span style={styles.fileMeta}>{formatBytes(message._size)}</span>
        ) : null}
      </button>
      {message.pending && <ProgressRing value={message.progress} />}
    </div>
  );
}

/** Body of a message, accounting for attachments and encryption failures. */
function MessageBody({ message, onOpen, onDownload, onRetry }) {
  if (message.decryptError === "locked") {
    return <em style={styles.systemNote}>🔒 برای خواندن این پیام، گفتگوی محرمانه را باز کنید</em>;
  }
  if (message.decryptError === "failed") {
    return (
      <em style={styles.systemNote}>
        🔒 رمزگشایی ممکن نیست — این پیام برای کلید دیگری ارسال شده است
      </em>
    );
  }

  if (isMedia(message)) {
    return (
      <MediaAttachment
        message={message}
        onOpen={onOpen}
        onDownload={onDownload}
        onRetry={onRetry}
      />
    );
  }

  return (
    <div dir="auto" className="msg-text" style={styles.text}>
      {message.content}
    </div>
  );
}

export default function MessageList({
  messages,
  me,
  onReply,
  onDelete,
  onRetryMedia,
  secure = false,
}) {
  const bottomRef = useRef(null);
  const scrollRef = useRef(null);
  const pinnedToBottom = useRef(true);

  const [heldId, setHeldId] = useState(null);
  const [preview, setPreview] = useState(null);
  const holdTimer = useRef(null);

  // Drives the self-destruct countdowns and hides a message the instant its
  // timer runs out, rather than waiting for the server's sweep broadcast.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const hasTimers = messages.some((m) => m.expires_at);
    if (!hasTimers) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [messages]);

  // Only auto-scroll when the user is already at the bottom, so arriving
  // messages do not yank them away from history they are reading.
  useEffect(() => {
    if (pinnedToBottom.current) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    pinnedToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  function startHold(message) {
    holdTimer.current = setTimeout(() => setHeldId(message.id), 450);
  }
  function endHold() {
    clearTimeout(holdTimer.current);
  }

  function closePreview() {
    // The URL is either a cached blob (owned by the media cache) or a local
    // preview (owned by useChat) — never revoke it here.
    setPreview(null);
  }

  async function download(message) {
    try {
      await downloadMedia(message.id, message.filename || message.content || "file");
    } catch {
      alert("دانلود فایل ناموفق بود");
    }
  }

  function copy(message) {
    const text = message.content || message.filename || "";
    if (text && navigator.clipboard) navigator.clipboard.writeText(text);
    setHeldId(null);
  }

  const byId = new Map(messages.map((m) => [m.id, m]));

  // Delivery state is shown by the bubble's own colour rather than by a tick,
  // so the three states have to stay clearly distinguishable from each other
  // and from an incoming bubble.
  function outgoingBubble(status) {
    if (status === "seen") {
      return {
        background: "var(--success)",
        color: "#fff",
        borderColor: "transparent",
      };
    }
    if (status === "delivered") {
      return {
        background: "var(--primary)",
        color: "var(--primary-contrast)",
        borderColor: "transparent",
      };
    }
    // 'sent' and anything unrecognised: on the server, not yet on the device.
    return {
      background: "var(--bubble-sent)",
      color: "var(--bubble-sent-text)",
      borderColor: "var(--bubble-sent-border)",
    };
  }

  // Colour alone is not an accessible signal, so the state is also exposed as
  // text to assistive technology and on hover.
  const STATUS_LABEL = {
    sent: "ارسال شد",
    delivered: "تحویل شد",
    seen: "خوانده شد",
  };

  return (
    <>
      {preview && (
        <ImageModal
          imageUrl={preview.url}
          filename={preview.filename}
          isVideo={preview.kind === "video"}
          onClose={closePreview}
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

      <div className="scroll-area" ref={scrollRef} onScroll={onScroll} style={styles.list}>
        <div style={styles.listInner}>
        {messages.length === 0 && (
          <div style={styles.empty}>
            {secure ? "🔒 هنوز پیامی در این گفتگوی محرمانه نیست" : "هنوز پیامی نیست"}
          </div>
        )}

        {messages.map((m) => {
          // Hide a self-destruct message the moment its timer elapses; the
          // server sweep will remove it for good within a few seconds.
          if (m.expires_at && new Date(m.expires_at).getTime() <= now) {
            return null;
          }

          if (isSystem(m)) {
            return (
              <div key={m.id} style={styles.systemRow}>
                <span style={styles.systemPill}>{m.content}</span>
              </div>
            );
          }

          const mine = m.from === me;
          const replied = m.reply_to ? byId.get(m.reply_to) : null;
          const canDeleteEveryone = mine || secure;

          return (
            <div
              key={m.id}
              style={{
                ...styles.row,
                justifyContent: mine ? "flex-end" : "flex-start",
              }}
            >
              <div
                className="bubble-in"
                onMouseDown={() => startHold(m)}
                onMouseUp={endHold}
                onMouseLeave={endHold}
                onTouchStart={() => startHold(m)}
                onTouchEnd={endHold}
                title={mine ? STATUS_LABEL[m.status] || STATUS_LABEL.sent : undefined}
                style={{
                  ...styles.bubble,
                  ...(mine
                    ? outgoingBubble(m.status)
                    : {
                        background: "var(--bubble-in)",
                        color: "var(--bubble-in-text)",
                        borderColor: "transparent",
                      }),
                  ...(m.pending ? styles.bubblePending : null),
                }}
              >
                {!mine && <div style={styles.sender}>{m.from}</div>}

                {replied && (
                  <div style={styles.replyPreview}>
                    <strong style={{ fontSize: 11 }}>{replied.from}</strong>
                    <div dir="auto" style={styles.replyText}>
                      {isMedia(replied)
                        ? `📎 ${replied.filename || replied.content}`
                        : replied.content}
                    </div>
                  </div>
                )}

                <MessageBody
                  message={m}
                  onOpen={setPreview}
                  onDownload={download}
                  onRetry={onRetryMedia}
                />

                <div style={styles.meta}>
                  {secure && <span title="رمزنگاری سرتاسری">🔒 </span>}
                  {m.pending
                    ? `در حال بارگذاری… ${Math.round(m.progress || 0)}%`
                    : formatTime(m.created_at)}
                  {m.expires_at && (
                    <SelfDestructBadge expiresAt={m.expires_at} now={now} />
                  )}
                  {mine && (
                    <span className="sr-only">
                      {" — "}
                      {STATUS_LABEL[m.status] || STATUS_LABEL.sent}
                    </span>
                  )}
                </div>

                {heldId === m.id && !m.pending && !m.failed && (
                  <div style={styles.actions}>
                    <button
                      style={styles.action}
                      onClick={() => {
                        onReply(m);
                        setHeldId(null);
                      }}
                    >
                      ↩ پاسخ
                    </button>
                    {!isMedia(m) && !m.decryptError && (
                      <button style={styles.action} onClick={() => copy(m)}>
                        📋 کپی
                      </button>
                    )}
                    {isMedia(m) && !m.failed && (
                      <button style={styles.action} onClick={() => download(m)}>
                        📥 ذخیره
                      </button>
                    )}
                    {onDelete && (
                      <button
                        style={styles.action}
                        onClick={() => {
                          onDelete(m, "me");
                          setHeldId(null);
                        }}
                      >
                        🗑 حذف برای من
                      </button>
                    )}
                    {onDelete && canDeleteEveryone && (
                      <button
                        style={styles.action}
                        onClick={() => {
                          onDelete(m, "everyone");
                          setHeldId(null);
                        }}
                      >
                        🗑 حذف برای همه
                      </button>
                    )}
                    <button style={styles.action} onClick={() => setHeldId(null)}>
                      ✕
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        <div ref={bottomRef} />
        </div>
      </div>
    </>
  );
}

const styles = {
  // The scroll container stays full-bleed so the wheel works anywhere over the
  // pane and the scrollbar sits at the window edge; the inner track carries
  // the reading width.
  list: { padding: 0 },
  listInner: {
    // Centred on a wide screen for the same reason the chat list is: a
    // transcript spanning a full monitor puts an incoming bubble and the reply
    // to it at opposite edges, which is unreadable.
    width: "100%",
    maxWidth: "var(--pane-max)",
    margin: "0 auto",
    minHeight: "100%",
    padding: "10px 8px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    gap: 6,
  },
  empty: {
    textAlign: "center",
    color: "var(--subtext)",
    fontSize: 14,
    marginTop: 32,
  },
  row: { display: "flex" },
  systemRow: {
    display: "flex",
    justifyContent: "center",
    margin: "4px 0",
  },
  systemPill: {
    fontSize: 12,
    color: "var(--subtext)",
    background: "var(--bubble-in)",
    borderRadius: 12,
    padding: "4px 12px",
    textAlign: "center",
    maxWidth: "90%",
  },
  bubble: {
    maxWidth: "min(85%, 560px)",
    padding: "10px 14px",
    borderRadius: 18,
    wordBreak: "break-word",
    overflowWrap: "anywhere",
    // Always present, transparent unless the delivery state needs it, so a
    // bubble does not change size as it moves from sent to delivered.
    border: "1px solid transparent",
  },
  bubblePending: { opacity: 0.85 },
  sender: { fontSize: 12, fontWeight: 700, opacity: 0.85, marginBottom: 4 },
  text: { lineHeight: 1.45, whiteSpace: "pre-wrap", textAlign: "start" },
  systemNote: { opacity: 0.85, fontSize: 13 },
  meta: {
    fontSize: 11,
    opacity: 0.7,
    marginTop: 4,
    textAlign: "end",
    direction: "ltr",
  },
  replyPreview: {
    background: "rgba(0,0,0,0.12)",
    padding: "6px 8px",
    borderRadius: 6,
    marginBottom: 6,
  },
  replyText: {
    fontSize: 12,
    opacity: 0.85,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textAlign: "start",
  },
  actions: { display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" },
  action: { fontSize: 12, opacity: 0.85, color: "inherit", padding: "2px 4px" },

  // --- attachments ---
  mediaWrap: {
    position: "relative",
    width: "min(66vw, 260px)",
    borderRadius: 14,
    overflow: "hidden",
    background: "rgba(0,0,0,0.08)",
    marginBottom: 2,
  },
  mediaThumb: {
    display: "block",
    width: "100%",
    maxHeight: 320,
    objectFit: "cover",
    cursor: "pointer",
    background: "#000",
  },
  mediaPlaceholder: {
    width: "100%",
    minHeight: 150,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    color: "inherit",
    cursor: "pointer",
  },
  mediaOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.15)",
  },
  expandBtn: {
    position: "absolute",
    top: 6,
    insetInlineEnd: 6,
    width: 30,
    height: 30,
    borderRadius: "50%",
    background: "rgba(0,0,0,0.55)",
    color: "#fff",
    fontSize: 14,
    lineHeight: 1,
  },
  playGlyph: {
    fontSize: 34,
    width: 60,
    height: 60,
    borderRadius: "50%",
    background: "rgba(0,0,0,0.5)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  mediaHint: { fontSize: 12, opacity: 0.85 },
  mediaFailed: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    fontSize: 13,
  },
  retryBtn: {
    fontSize: 12,
    fontWeight: 700,
    padding: "2px 10px",
    borderRadius: 12,
    background: "rgba(0,0,0,0.15)",
    color: "inherit",
  },
  fileRow: { display: "flex", alignItems: "center", gap: 10 },
  fileButton: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    color: "inherit",
    padding: 0,
    textAlign: "start",
    fontSize: "inherit",
    wordBreak: "break-all",
  },
  fileMeta: { fontSize: 11, opacity: 0.7, whiteSpace: "nowrap" },
};
