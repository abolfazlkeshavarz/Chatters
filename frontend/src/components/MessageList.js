import { useEffect, useRef, useState } from "react";
import { fetchMediaURL } from "../api/media";
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

function isImage(m) {
  if (m.mime_type) return m.mime_type.startsWith("image/");
  const name = m.filename || m.content || "";
  return /\.(jpe?g|png|gif|bmp|webp|avif)$/i.test(name);
}

/** Body of a message, accounting for attachments and encryption failures. */
function MessageBody({ message, onOpenImage, onDownload }) {
  if (message.decryptError === "locked") {
    return <em style={styles.systemNote}>🔒 Unlock secure chat to read this message</em>;
  }
  if (message.decryptError === "failed") {
    return (
      <em style={styles.systemNote}>
        🔒 Cannot decrypt — this message was sent to a different key
      </em>
    );
  }

  if (isMedia(message)) {
    const label = message.filename || message.content || "attachment";

    if (isImage(message)) {
      return (
        <button style={styles.imageButton} onClick={() => onOpenImage(message)}>
          <span style={styles.imageThumb}>🖼️</span>
          <span style={styles.imageLabel}>{label}</span>
          <span style={styles.imageHint}>Tap to view</span>
        </button>
      );
    }

    return (
      <button style={styles.fileButton} onClick={() => onDownload(message)}>
        📎 {label}
      </button>
    );
  }

  return (
    <div dir="auto" style={styles.text}>
      {message.content}
    </div>
  );
}

export default function MessageList({ messages, me, onReply, secure = false }) {
  const bottomRef = useRef(null);
  const scrollRef = useRef(null);
  const pinnedToBottom = useRef(true);

  const [heldId, setHeldId] = useState(null);
  const [preview, setPreview] = useState(null);
  const holdTimer = useRef(null);

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

  async function openImage(message) {
    try {
      const url = await fetchMediaURL(message.id);
      setPreview({ url, filename: message.filename || message.content });
    } catch {
      alert("نمایش عکس ناموفق بود");
    }
  }

  function closePreview() {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  async function download(message) {
    try {
      const url = await fetchMediaURL(message.id);
      const a = document.createElement("a");
      a.href = url;
      a.download = message.filename || message.content || "file";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
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
    sent: "Sent",
    delivered: "Delivered",
    seen: "Read",
  };

  return (
    <>
      {preview && (
        <ImageModal
          imageUrl={preview.url}
          filename={preview.filename}
          onClose={closePreview}
          onDownload={() => {
            const a = document.createElement("a");
            a.href = preview.url;
            a.download = preview.filename || "image";
            document.body.appendChild(a);
            a.click();
            a.remove();
          }}
        />
      )}

      <div className="scroll-area" ref={scrollRef} onScroll={onScroll} style={styles.list}>
        {messages.length === 0 && (
          <div style={styles.empty}>
            {secure ? "🔒 No messages yet in this secure chat" : "No messages yet"}
          </div>
        )}

        {messages.map((m) => {
          const mine = m.from === me;
          const replied = m.reply_to ? byId.get(m.reply_to) : null;

          return (
            <div
              key={m.id}
              style={{
                ...styles.row,
                justifyContent: mine ? "flex-end" : "flex-start",
              }}
            >
              <div
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
                  onOpenImage={openImage}
                  onDownload={download}
                />

                <div style={styles.meta}>
                  {secure && <span title="End-to-end encrypted">🔒 </span>}
                  {formatTime(m.created_at)}
                  {mine && (
                    <span className="sr-only">
                      {" — "}
                      {STATUS_LABEL[m.status] || STATUS_LABEL.sent}
                    </span>
                  )}
                </div>

                {heldId === m.id && (
                  <div style={styles.actions}>
                    <button
                      style={styles.action}
                      onClick={() => {
                        onReply(m);
                        setHeldId(null);
                      }}
                    >
                      ↩ Reply
                    </button>
                    {!isMedia(m) && !m.decryptError && (
                      <button style={styles.action} onClick={() => copy(m)}>
                        📋 Copy
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
    </>
  );
}

const styles = {
  list: {
    padding: "10px 8px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  empty: {
    textAlign: "center",
    color: "var(--subtext)",
    fontSize: 14,
    marginTop: 32,
  },
  row: { display: "flex" },
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
  imageButton: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 2,
    color: "inherit",
    padding: 0,
    textAlign: "start",
  },
  imageThumb: { fontSize: 40 },
  imageLabel: { fontSize: 13, wordBreak: "break-all" },
  imageHint: { fontSize: 11, opacity: 0.75 },
  fileButton: {
    color: "inherit",
    padding: 0,
    textAlign: "start",
    fontSize: "inherit",
    wordBreak: "break-all",
  },
};
