import { useEffect, useRef, useState } from "react";
import { getMessages } from "../api/messages";
import { connectWebSocket } from "../services/websocket";
import { uploadMedia } from "../api/media";

const USERS_WITH_NOTIFICATION = ["abolam"];

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function copyMessageContent(message) {
  if (!message?.content && !message?.filename) return;

  const textToCopy = message.content || message.filename;
  navigator.clipboard.writeText(textToCopy).then(() => {
    console.log("Message copied");
  });
}

// Helper function to check if message is media
function isMediaMessage(message) {
  return (
    message.type === "media" ||
    message.filename ||
    message.file_path ||
    message.mime_type
  );
}

// Image preview modal component
function ImageModal({ imageUrl, filename, onClose, onDownload }) {
  return (
    <div style={styles.imageModalOverlay}>
      <div style={styles.imageModal}>
        <div style={styles.imageModalHeader}>
          <button style={styles.imageModalClose} onClick={onClose}>
            ✕
          </button>
          <button style={styles.imageModalDownload} onClick={onDownload}>
            📥
          </button>
        </div>
        <img src={imageUrl} alt={filename} style={styles.imageModalContent} />
        <div style={styles.imageModalFilename}>{filename}</div>
      </div>
    </div>
  );
}

export default function Chat({ chatId, title, onBack }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [showNotification, setShowNotification] = useState(false);

  // 🔁 reply feature state
  const [replyTo, setReplyTo] = useState(null);
  const [heldMessageId, setHeldMessageId] = useState(null);

  // Image preview state
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedImageUrl, setSelectedImageUrl] = useState(null);
  const [hoveredImageId, setHoveredImageId] = useState(null);

  const wsRef = useRef(null);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const holdTimerRef = useRef(null);
  const inputRef = useRef(null);

  const me = localStorage.getItem("username");
  const token = localStorage.getItem("token");

  useEffect(() => {
    getMessages(chatId).then((data) => setMessages(data || []));

    wsRef.current = connectWebSocket((msg) => {
      if (msg.chat_id !== chatId) return;

      if (msg.type === "message") {
        // Check if it's actually a media message but incorrectly typed
        if (msg.filename || msg.file_path || msg.mime_type) {
          // Normalize to media type
          setMessages((prev) => [...prev, { ...msg, type: "media" }]);
        } else {
          setMessages((prev) => [...prev, msg]);
        }
      } else if (msg.type === "media") {
        setMessages((prev) => [...prev, msg]);
      }

      if (msg.type === "seen") {
        setMessages((prev) =>
          prev.map((m) =>
            msg.message_ids.includes(m.id) ? { ...m, status: "seen" } : m
          )
        );
      }
    });

    wsRef.current.onopen = () => {
      wsRef.current.send(JSON.stringify({ type: "seen", chat_id: chatId }));
    };

    return () => wsRef.current?.close();
  }, [chatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Prevent zoom on mobile when focusing input
  useEffect(() => {
    const handleFocus = () => {
      if (window.innerWidth <= 768) {
        document.body.style.zoom = "1";
      }
    };

    const input = inputRef.current;
    if (input) {
      input.addEventListener("focus", handleFocus);
      return () => input.removeEventListener("focus", handleFocus);
    }
  }, []);

  const shouldShowNotificationButton = () => {
    return USERS_WITH_NOTIFICATION.includes(me);
  };

  // Check if file is an image
  const isImageFile = (filename, mimeType) => {
    if (mimeType) {
      return mimeType.startsWith("image/");
    }
    if (!filename) return false;
    const ext = filename.split(".").pop().toLowerCase();
    return ["jpg", "jpeg", "png", "gif", "bmp", "webp"].includes(ext);
  };

  // 🔁 long-press handlers
  function startHold(message) {
    holdTimerRef.current = setTimeout(() => {
      setHeldMessageId(message.id);
    }, 500);
  }

  function endHold() {
    clearTimeout(holdTimerRef.current);
  }

  function sendMessage() {
    if (!text.trim()) return;

    wsRef.current.send(
      JSON.stringify({
        chat_id: chatId,
        content: text,
        reply_to: replyTo?.id || null,
      })
    );

    setText("");
    setReplyTo(null);
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  }

  async function handleAttach(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      await uploadMedia(chatId, file);
    } catch {
      alert("آپلود فایل ناموفق بود");
    }

    e.target.value = "";
  }

  async function downloadMedia(id, filename, filePath = null) {
    try {
      // If we have an image preview open and want to download it
      if (selectedImage && selectedImageUrl) {
        const a = document.createElement("a");
        a.href = selectedImageUrl;
        a.download = filename;
        a.click();
        return;
      }

      // Normal download via API
      const res = await fetch(`/api/media/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error();

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();

      window.URL.revokeObjectURL(url);
    } catch {
      alert("دانلود فایل ناموفق بود");
    }
  }

  function findMessageById(id) {
    return messages.find((m) => m.id === id);
  }

  // Handle image click - show full image modal
  const handleImageClick = async (message) => {
    if (!message.file_path) return;

    try {
      const res = await fetch(`/api/media/${message.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error();

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);

      setSelectedImage(message);
      setSelectedImageUrl(url);
    } catch {
      alert("نمایش عکس ناموفق بود");
    }
  };

  // Close image modal
  const handleCloseImage = () => {
    if (selectedImageUrl) {
      window.URL.revokeObjectURL(selectedImageUrl);
    }
    setSelectedImage(null);
    setSelectedImageUrl(null);
  };

  // Handle image hover
  const handleImageMouseEnter = (messageId) => {
    setHoveredImageId(messageId);
  };

  const handleImageMouseLeave = () => {
    setHoveredImageId(null);
  };

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <button style={styles.back} onClick={onBack}>
          ←
        </button>
        <div style={styles.titleWrapper}>
          <div style={styles.titleContainer}>
            <div style={styles.title}>{title}</div>

            {shouldShowNotificationButton() && (
              <button
                style={styles.notificationButton}
                onClick={() => setShowNotification(true)}
              >
                <span style={styles.notificationTextButton}>
                  هشدار لطفا بخوانید
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Notification Modal */}
      {showNotification && (
        <div style={styles.notificationOverlay}>
          <div style={styles.notificationModal}>
            <div style={styles.notificationContent}>
              <div style={styles.notificationIcon}>⚠️</div>
              <div style={styles.notificationText}>
                🙏 یادته دیگه؟ اگه نه صفحه اصلیو بخون
              </div>
              <button
                style={styles.notificationClose}
                onClick={() => setShowNotification(false)}
              >
                یادمه
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {selectedImage && selectedImageUrl && (
        <ImageModal
          imageUrl={selectedImageUrl}
          filename={selectedImage.filename || selectedImage.content}
          onClose={handleCloseImage}
          onDownload={() =>
            downloadMedia(
              selectedImage.id,
              selectedImage.filename || selectedImage.content
            )
          }
        />
      )}

      {/* Messages */}
      <div style={styles.messages}>
        {messages.map((m) => {
          const isMe = m.from === me;
          const isMedia = isMediaMessage(m);
          const isImage =
            isMedia &&
            isImageFile(m.filename || m.content, m.mime_type);
          const isHovered = hoveredImageId === m.id;

          return (
            <div
              key={m.id}
              style={{
                ...styles.row,
                justifyContent: isMe ? "flex-end" : "flex-start",
              }}
            >
              <div
                onMouseDown={() => startHold(m)}
                onMouseUp={endHold}
                onMouseLeave={endHold}
                onTouchStart={() => startHold(m)}
                onTouchEnd={endHold}
                style={{
                  ...styles.bubble,
                  background: isMe
                    ? m.status === "seen"
                      ? "#34c759"
                      : "#007aff"
                    : "#e5e5ea",
                  color: isMe ? "#fff" : "#000",
                  maxWidth: isImage ? "70%" : "85%",
                }}
              >
                {/* Show sender name for others' messages (like Telegram) */}
                {!isMe && <div style={styles.senderName}>{m.from}</div>}

                {/* reply preview inside bubble */}
                {m.reply_to &&
                  (() => {
                    const replied = findMessageById(m.reply_to);
                    if (!replied) return null;

                    return (
                      <div style={styles.replyPreview}>
                        <strong style={{ fontSize: 11 }}>{replied.from}</strong>
                        <div
                          style={{
                            fontSize: 12,
                            opacity: 0.8,
                            direction: "auto",
                            unicodeBidi: "plaintext",
                            textAlign: "start",
                          }}
                          dir="auto"
                        >
                          {isMediaMessage(replied)
                            ? `📎 ${replied.filename || replied.content}`
                            : replied.content}
                        </div>
                      </div>
                    );
                  })()}

                {/* Media message */}
                {isMedia ? (
                  <div>
                    {isImage ? (
                      // Image preview like Telegram
                      <div style={styles.imageContainer}>
                        <div
                          style={styles.imagePreview}
                          onClick={() => handleImageClick(m)}
                          onMouseEnter={() => handleImageMouseEnter(m.id)}
                          onMouseLeave={handleImageMouseLeave}
                        >
                          <div style={styles.imagePlaceholder}>
                            <div style={styles.imageLoading}>📷</div>
                          </div>
                          <div
                            style={{
                              ...styles.imageOverlay,
                              opacity: isHovered ? 1 : 0,
                            }}
                          >
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                downloadMedia(
                                  m.id,
                                  m.filename || m.content,
                                  m.file_path
                                );
                              }}
                              style={styles.downloadButton}
                            >
                              📥
                            </button>
                          </div>
                        </div>
                        <div style={styles.imageCaption}>
                          {m.filename || m.content}
                        </div>
                      </div>
                    ) : (
                      // Non-image file
                      <button
                        onClick={() =>
                          downloadMedia(m.id, m.filename || m.content)
                        }
                        style={styles.mediaBtn}
                      >
                        📎 {m.filename || m.content}
                      </button>
                    )}
                  </div>
                ) : (
                  // Text message
                  <div
                    style={{
                      ...styles.textContent,
                      direction: "auto",
                      unicodeBidi: "plaintext",
                      textAlign: "start",
                    }}
                    dir="auto"
                  >
                    {m.content}
                  </div>
                )}

                <div style={styles.time}>{formatTime(m.created_at)}</div>

                {heldMessageId === m.id && (
                  <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
                    <button
                      style={styles.replyBtn}
                      onClick={() => {
                        setReplyTo(m);
                        setHeldMessageId(null);
                      }}
                    >
                      ↩ Reply
                    </button>

                    {!isMedia && (
                      <button
                        style={styles.replyBtn}
                        onClick={() => {
                          copyMessageContent(m);
                          setHeldMessageId(null);
                        }}
                      >
                        📋 Copy
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Reply preview above input */}
      {replyTo && (
        <div style={styles.replyBox}>
          <strong>{replyTo.from}</strong>
          <div
            style={{
              ...styles.replyText,
              direction: "auto",
              unicodeBidi: "plaintext",
              textAlign: "start",
            }}
            dir="auto"
          >
            {replyTo.content || replyTo.filename}
          </div>

          <button
            style={styles.closeReplyBtn}
            onClick={() => setReplyTo(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Input */}
      <div style={styles.inputBar}>
        <button
          style={styles.attach}
          onClick={() => fileInputRef.current.click()}
        >
          📎
        </button>

        <input
          ref={fileInputRef}
          type="file"
          style={{ display: "none" }}
          onChange={handleAttach}
        />

        <textarea
          ref={inputRef}
          rows={1}
          style={{
            ...styles.input,
            resize: "none",
            overflow: "auto",
            maxHeight: "120px",
            direction: "auto",
            unicodeBidi: "plaintext",
            textAlign: "start",
          }}
          dir="auto"
          value={text}
          placeholder="پیام"
          onChange={(e) => {
            setText(e.target.value);

            // auto-grow on mobile
            e.target.style.height = "auto";
            e.target.style.height = `${e.target.scrollHeight}px`;
          }}
          onKeyDown={(e) => {
            // DO NOTHING on Enter
            // default behavior = new line
          }}
        />

        <button
          style={{
            ...styles.send,
            opacity: text.trim() ? 1 : 0.5,
          }}
          onClick={sendMessage}
          disabled={!text.trim()}
        >
          ➤
        </button>
      </div>
    </div>
  );
}

const styles = {
  page: {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    background: "#f2f2f7",
    fontSize: "16px", // Prevent iOS zoom by setting base font size
  },
  header: {
    height: "56px",
    display: "flex",
    alignItems: "center",
    padding: "0 12px",
    borderBottom: "1px solid #ddd",
    background: "#fff",
    position: "sticky",
    top: 0,
    zIndex: 10,
    flexShrink: 0,
  },
  back: {
    fontSize: "24px",
    border: "none",
    background: "none",
    minWidth: "40px",
    cursor: "pointer",
    padding: "8px",
  },
  titleWrapper: { flex: 1 },
  titleContainer: { display: "flex", gap: "8px" },
  title: { fontSize: "16px", fontWeight: 600 },

  messages: {
    flex: 1,
    padding: "10px 8px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    WebkitOverflowScrolling: "touch", // Smooth scrolling on iOS
  },
  row: { display: "flex" },
  bubble: {
    maxWidth: "85%",
    padding: "10px 14px",
    borderRadius: "18px",
    position: "relative",
    wordBreak: "break-word",
  },
  senderName: {
    fontSize: "12px",
    fontWeight: "bold",
    opacity: 0.8,
    marginBottom: "4px",
  },
  textContent: {
    lineHeight: "1.4",
  },
  replyBtn: {
    marginTop: "6px",
    fontSize: "12px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    opacity: 0.7,
    color: "inherit",
  },
  replyBox: {
    background: "#eee",
    padding: "8px",
    borderLeft: "3px solid #007aff",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  closeReplyBtn: {
    background: "transparent",
    border: "none",
    fontSize: "16px",
    cursor: "pointer",
    padding: "4px",
  },
  replyPreview: {
    background: "rgba(0,0,0,0.1)",
    padding: "6px 8px",
    borderRadius: "6px",
    marginBottom: "6px",
  },

  replyText: {
    fontSize: "13px",
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  time: {
    fontSize: "11px",
    opacity: 0.6,
    marginTop: "4px",
    textAlign: "end",
    direction: "ltr",
  },
  mediaBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    padding: 0,
    color: "inherit",
    fontFamily: "inherit",
    fontSize: "inherit",
  },

  // Image preview styles
  imageContainer: {
    width: "100%",
    maxWidth: "300px",
  },
  imagePreview: {
    position: "relative",
    width: "100%",
    paddingBottom: "100%", // Makes it square
    backgroundColor: "#000",
    borderRadius: "8px",
    overflow: "hidden",
    cursor: "pointer",
  },
  imagePlaceholder: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  imageLoading: {
    fontSize: "48px",
    opacity: 0.7,
  },
  imageOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0,0,0,0.3)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "opacity 0.2s",
  },
  downloadButton: {
    background: "rgba(0,0,0,0.7)",
    border: "none",
    borderRadius: "50%",
    width: "44px",
    height: "44px",
    fontSize: "20px",
    color: "#fff",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  imageCaption: {
    fontSize: "12px",
    opacity: 0.8,
    marginTop: "4px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  // Image modal styles
  imageModalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.9)",
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  imageModal: {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
  },
  imageModalHeader: {
    padding: "16px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  imageModalClose: {
    background: "rgba(255,255,255,0.2)",
    border: "none",
    borderRadius: "50%",
    width: "44px",
    height: "44px",
    fontSize: "20px",
    color: "#fff",
    cursor: "pointer",
  },
  imageModalDownload: {
    background: "rgba(255,255,255,0.2)",
    border: "none",
    borderRadius: "50%",
    width: "44px",
    height: "44px",
    fontSize: "20px",
    color: "#fff",
    cursor: "pointer",
  },
  imageModalContent: {
    flex: 1,
    objectFit: "contain",
    width: "100%",
    height: "calc(100% - 100px)",
  },
  imageModalFilename: {
    padding: "16px",
    color: "#fff",
    textAlign: "center",
    fontSize: "14px",
    backgroundColor: "rgba(0,0,0,0.5)",
  },

  inputBar: {
    display: "flex",
    padding: "8px",
    gap: "8px",
    borderTop: "1px solid #ddd",
    background: "#fff",
    flexShrink: 0,
    alignItems: "center",
  },
  attach: {
    width: "42px",
    height: "42px",
    borderRadius: "50%",
    border: "none",
    background: "none",
    fontSize: "20px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  },
  input: {
    flex: 1,
    padding: "10px 16px",
    borderRadius: "20px",
    border: "1px solid #ccc",
    fontSize: "16px", // Prevents iOS zoom
    lineHeight: "1.5",
    minHeight: "44px", // Better touch target
    outline: "none",
    WebkitAppearance: "none", // Removes iOS shadow
    fontFamily: "inherit",
  },
  send: {
    width: "42px",
    height: "42px",
    borderRadius: "50%",
    border: "none",
    background: "#007aff",
    color: "#fff",
    fontSize: "16px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  },
};