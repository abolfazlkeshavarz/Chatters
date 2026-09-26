import { useEffect, useState } from "react";
import { applyUpdate, subscribeUpdate } from "../serviceWorkerRegistration";

/**
 * Offers the update once a newer build has been downloaded in the background.
 * Rendered at the app root, outside any transformed ancestor, so its fixed
 * position is relative to the screen rather than to a page.
 *
 * Dismissing hides it for this session only: the next launch offers again,
 * so a user cannot get stuck on an old version by tapping the wrong thing.
 */
export default function UpdateBanner() {
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeUpdate(setReady), []);

  if (!ready || dismissed) return null;

  return (
    <div className="update-banner" role="status">
      <span className="update-banner-text">نسخه جدید آماده است</span>
      <button
        className="update-banner-btn"
        onClick={() => {
          setBusy(true);
          applyUpdate();
        }}
        disabled={busy}
      >
        {busy ? "…" : "به‌روزرسانی"}
      </button>
      {!busy && (
        <button
          className="update-banner-close"
          onClick={() => setDismissed(true)}
          aria-label="بعداً"
        >
          ✕
        </button>
      )}
    </div>
  );
}
