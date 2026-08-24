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
  const inputRef = useRef(null);
  const fileRef = useRef(null);

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
    <div style={styles.wrap}>
      {replyTo && (
        <div style={styles.replyBar}>
          <div style={styles.replyBody}>
            <strong style={{ fontSize: 12 }}>{replyTo.from}</strong>
            <div dir="auto" style={styles.replyText}>
              {replyTo.content || replyTo.filename || "attachment"}
            </div>
          </div>
          <button onClick={onCancelReply} aria-label="Cancel reply" style={styles.cancel}>
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
              aria-label="Attach file"
            >
              📎
            </button>
            <input
              ref={fileRef}
              type="file"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onAttach(file);
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
          aria-label="Send"
        >
          ➤
        </button>
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    flexShrink: 0,
    borderTop: "1px solid var(--border)",
    background: "var(--card)",
    paddingBottom: "var(--safe-bottom)",
  },
  bar: {
    display: "flex",
    padding: 8,
    gap: 8,
    alignItems: "flex-end",
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
