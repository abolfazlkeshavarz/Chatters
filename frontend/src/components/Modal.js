import { useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * A dialog rendered into document.body rather than where it appears in the
 * tree.
 *
 * `position: fixed` is only viewport-relative while no ancestor establishes a
 * containing block for it — a transform, filter, or `will-change` anywhere up
 * the tree silently re-anchors it to that element instead. A z-index has the
 * same fragility: it only competes inside its own stacking context, so an
 * overlay at z-index 1000 still loses to the bottom tab bar when the pane it
 * sits inside forms a context of its own and the tab bar follows that pane in
 * document order. Both were live risks here — the page-transition animation
 * puts a transform on `.app-content`, and `.tabbar` is its next sibling.
 *
 * Portalling sidesteps the entire class of problem: the overlay becomes a
 * direct child of <body>, so there is nothing between it and the viewport.
 *
 * Escape closes, and the page behind is locked so a phone does not scroll the
 * list underneath a sheet the user is reading.
 */
export default function Modal({ onClose, children, maxWidth, labelledBy }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);

    // Restored to whatever it was rather than hardcoded back to "", so two
    // stacked dialogs cannot unlock the page when only the inner one closes.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        style={maxWidth ? { maxWidth } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
