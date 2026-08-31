import { api, getToken } from "./client";

export function uploadAvatar(file) {
  const form = new FormData();
  form.append("file", file);
  return api.post("/api/profile/avatar", form);
}

export function deleteAvatar() {
  return api.del("/api/profile/avatar");
}

export function setAvatarVisibility(visibility) {
  return api.put("/api/profile/avatar-visibility", { visibility });
}

/**
 * Fetches a user's avatar as an object URL, or null if they have none / it is
 * not visible to the caller (both are a plain 404 — the server does not
 * distinguish them, so this does not either). Callers must revoke the URL
 * when done, same as fetchMediaURL.
 *
 * Fetched with no-store: the URL is the same before and after someone
 * replaces their photo (it is just their user id), so anything cached could
 * go stale the moment they do.
 */
export async function fetchAvatarURL(userId) {
  const res = await fetch(`/api/avatars/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return URL.createObjectURL(await res.blob());
}
