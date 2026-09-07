import { useRef, useState } from "react";

/**
 * Message input bar. Attachments are hidden in secure chats: files are stored
 * on the server unencrypted, so offering them inside an end-to-end encrypted
 * conversation would quietly break the guarantee the padlock implies.
 */
export default function Composer({
  onSend,
  onAttach,
  replyTo,
  onCancelReply,
  disabled = false,
  allowAttachments = true,
  placeholder = "پیام",
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);
  const fileRef = useRef(null);

  // A multi-select, a drop, and a paste all end up here.
  function emitFiles(fileList) {
    if (!allowAttachments || disabled) return;
    const files = Array.from(fileList || []).filter(Boolean);
    if (files.length) onAttach(files);
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    emitFiles(e.dataTransfer?.files);
  }

  function onPaste(e) {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length) {
      e.preventDefault();
      emitFiles(files);
    }
  }

  async function submit() {
    const body = text.trim();
    if (!body || busy || disabled) return;

    setBusy(true);
    try {
      const ok = await onSend(body);
      if (ok !== false) {
        setText("");
        if (inputRef.current) inputRef.current.style.height = "auto";
      }
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e) {
    // Enter sends on a physical keyboard; Shift+Enter makes a new line. On
    // touch devices Enter always inserts a newline, since there is no other
    // way to get one.
    const isTouch = window.matchMedia("(pointer: coarse)").matches;
    if (e.key === "Enter" && !e.shiftKey && !isTouch) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div
      style={{ ...styles.wrap, ...(dragOver ? styles.wrapDragOver : null) }}
      onDragOver={(e) => {
        if (!allowAttachments || disabled) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {dragOver && <div style={styles.dropHint}>برای ارسال رها کنید</div>}
      {replyTo && (
        <div style={styles.replyBar}>
          <div style={styles.replyBody}>
            <strong style={{ fontSize: 12 }}>{replyTo.from}</strong>
            <div dir="auto" style={styles.replyText}>
              {replyTo.content || replyTo.filename || "attachment"}
            </div>
          </div>
          <button onClick={onCancelReply} aria-label="لغو پاسخ" style={styles.cancel}>
            ✕
          </button>
        </div>
      )}

      <div style={styles.bar}>
        {allowAttachments && (
          <>
            <button
              style={styles.iconBtn}
              onClick={() => fileRef.current?.click()}
              disabled={disabled}
              aria-label="پیوست فایل"
            >
              📎
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                emitFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </>
        )}

        <textarea
          ref={inputRef}
          rows={1}
          dir="auto"
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          style={styles.input}
          onKeyDown={onKeyDown}
          onPaste={allowAttachments ? onPaste : undefined}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
          }}
        />

        <button
          style={{ ...styles.send, opacity: text.trim() && !busy ? 1 : 0.5 }}
          onClick={submit}
          disabled={!text.trim() || busy || disabled}
          aria-label="ارسال"
        >
          ➤
        </button>
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    position: "relative",
    flexShrink: 0,
    borderTop: "1px solid var(--border)",
    background: "var(--card)",
    paddingBottom: "var(--safe-bottom)",
  },
  wrapDragOver: {
    outline: "2px dashed var(--primary)",
    outlineOffset: -4,
  },
  dropHint: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--card)",
    opacity: 0.94,
    color: "var(--primary)",
    fontWeight: 700,
    fontSize: 14,
    zIndex: 2,
    pointerEvents: "none",
  },
  bar: {
    display: "flex",
    padding: 8,
    gap: 8,
    alignItems: "flex-end",
    // Tracks the transcript above it, so on a wide screen the input does not
    // span the window while the messages it produces sit in a centred column.
    width: "100%",
    maxWidth: "var(--pane-max)",
    margin: "0 auto",
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: "50%",
    fontSize: 20,
    flexShrink: 0,
  },
  input: {
    flex: 1,
    padding: "10px 16px",
    borderRadius: 20,
    border: "1px solid var(--border)",
    fontSize: 16,
    lineHeight: 1.5,
    minHeight: 44,
    maxHeight: 120,
    resize: "none",
    outline: "none",
    WebkitAppearance: "none",
    fontFamily: "inherit",
    background: "var(--bg)",
    textAlign: "start",
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: "50%",
    background: "var(--primary)",
    color: "#fff",
    fontSize: 16,
    flexShrink: 0,
  },
  replyBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    background: "var(--bg)",
    borderInlineStart: "3px solid var(--primary)",
  },
  replyBody: { flex: 1, minWidth: 0 },
  replyText: {
    fontSize: 13,
    color: "var(--subtext)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textAlign: "start",
  },
  cancel: { fontSize: 16, padding: 4 },
};
