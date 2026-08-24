/**
 * Surfaces socket state. Previously a dropped connection was invisible: the
 * app looked fine and simply stopped receiving messages, which is what made
 * the app-switch bug so confusing to diagnose from the user's side.
 */
export default function ConnectionBanner({ status }) {
  if (status === "online") return null;

  const label =
    status === "connecting"
      ? "Connecting…"
      : status === "reconnecting"
      ? "Reconnecting…"
      : "Offline — messages will sync when you reconnect";

  return (
    <div className="conn-banner" role="status">
      {label}
    </div>
  );
}
