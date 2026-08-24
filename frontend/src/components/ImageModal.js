import { useEffect } from "react";

export default function ImageModal({ imageUrl, filename, onClose, onDownload }) {
  // Escape to dismiss, matching the rest of the app's modals.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={styles.overlay} role="dialog" aria-modal="true" aria-label={filename}>
      <div style={styles.header}>
        <button style={styles.circle} onClick={onClose} aria-label="Close">
          ✕
        </button>
        <button style={styles.circle} onClick={onDownload} aria-label="Download">
          📥
        </button>
      </div>

      <img src={imageUrl} alt={filename} style={styles.image} />

      <div style={styles.caption}>{filename}</div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.92)",
    zIndex: 1100,
    display: "flex",
    flexDirection: "column",
    paddingTop: "var(--safe-top)",
    paddingBottom: "var(--safe-bottom)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    padding: 16,
    flexShrink: 0,
  },
  circle: {
    background: "rgba(255,255,255,0.2)",
    borderRadius: "50%",
    width: 44,
    height: 44,
    fontSize: 20,
    color: "#fff",
  },
  image: {
    flex: 1,
    minHeight: 0,
    objectFit: "contain",
    width: "100%",
  },
  caption: {
    padding: 16,
    color: "#fff",
    textAlign: "center",
    fontSize: 14,
    wordBreak: "break-word",
    flexShrink: 0,
  },
};
