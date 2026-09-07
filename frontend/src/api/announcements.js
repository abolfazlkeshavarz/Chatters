import { api } from "./client";

/** Notices an administrator pinned for this user and they have not dismissed. */
export function getAnnouncements() {
  return api.get("/api/announcements");
}

/** Record the OK press. Idempotent server-side, so a retry is harmless. */
export function ackAnnouncement(id) {
  return api.post(`/api/announcements/${encodeURIComponent(id)}/ack`);
}
