import { api, apiUrl, authHeader } from "./client";

/**
 * @param {{uri: string, name?: string, mimeType?: string}} file picker result
 */
export function uploadAvatar(file) {
  const form = new FormData();
  form.append("file", {
    uri: file.uri,
    name: file.name || "avatar.jpg",
    type: file.mimeType || "image/jpeg",
  });
  return api.post("/api/profile/avatar", form);
}

export function deleteAvatar() {
  return api.del("/api/profile/avatar");
}

export function setAvatarVisibility(visibility) {
  return api.put("/api/profile/avatar-visibility", { visibility });
}

/**
 * <Image> source for a user's avatar. The endpoint 404s when the user has no
 * photo or it is not visible to the caller; the Avatar component treats a load
 * error as "no photo" and renders the coloured-initial fallback.
 *
 * `bust` (any changing value) forces RN's image cache to refetch after the
 * signed-in user replaces their own photo.
 */
export function avatarImageSource(userId, bust) {
  if (!userId) return null;
  const q = bust ? `?v=${encodeURIComponent(bust)}` : "";
  return {
    uri: apiUrl(`/api/avatars/${encodeURIComponent(userId)}`) + q,
    headers: authHeader(),
    cache: "reload",
  };
}
