import { api } from "./client";

/** The developer's profile, contacts and news (edited in Admin → Developer page). */
export function getDeveloperInfo() {
  return api.get("/api/developer");
}

const SEEN_KEY = "dev.seen";

export function markDeveloperSeen(latestAt) {
  if (latestAt) localStorage.setItem(SEEN_KEY, latestAt);
}

/** True when something was published or edited since this browser last looked. */
export function hasUnseenNews(info) {
  if (!info?.latest_at) return false;
  const hasContent = (info.posts || []).length > 0 || Boolean(info.profile?.name);
  return hasContent && localStorage.getItem(SEEN_KEY) !== info.latest_at;
}
