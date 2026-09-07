import { api, request, getToken, ApiError } from "./client";

/**
 * The shared public file/media library.
 *
 * A private entry is listed like any other — its name and owner are not the
 * secret — but its contents only come back once the uploader's password is
 * supplied. Owners and administrators skip that check server-side.
 */

export function listFiles({ search = "", mine = false, limit = 60, offset = 0 } = {}) {
  const params = new URLSearchParams({ search, limit, offset });
  if (mine) params.set("mine", "1");
  return api.get(`/api/files?${params}`);
}

/**
 * Upload with progress, for the same reason chat attachments use XHR: fetch()
 * cannot report how far a request body has got.
 */
export function uploadFile(
  { file, title, description, visibility, password },
  { onProgress } = {}
) {
  const xhr = new XMLHttpRequest();

  const promise = new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("title", title || "");
    form.append("description", description || "");
    form.append("visibility", visibility || "public");
    if (visibility === "private") form.append("password", password || "");

    xhr.open("POST", "/api/files");
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
      }
    };

    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* an error body is not always JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve(data || {});
      } else {
        reject(new ApiError((data && data.error) || `Upload failed (${xhr.status})`, xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError("Network error during upload", 0));
    xhr.onabort = () => reject(new ApiError("Upload cancelled", 0));

    xhr.send(form);
  });

  return { promise, abort: () => xhr.abort() };
}

/** Verify a private item's password before trying to render it. */
export function unlockFile(id, password) {
  return api.post(`/api/files/${encodeURIComponent(id)}/unlock`, { password });
}

export function updateFile(id, patch) {
  return api.put(`/api/files/${encodeURIComponent(id)}`, patch);
}

export function deleteFile(id) {
  return api.del(`/api/files/${encodeURIComponent(id)}`);
}

/**
 * Fetch an item's bytes as an object URL. The password rides in a header
 * rather than the query string so it stays out of access logs and browser
 * history; the server accepts either, because <video src> cannot set headers.
 */
export async function fetchFileURL(id, password) {
  const headers = { Authorization: `Bearer ${getToken()}` };
  if (password) headers["X-File-Password"] = password;

  const res = await fetch(`/api/files/${encodeURIComponent(id)}/download`, { headers });
  if (!res.ok) {
    if (res.status === 403) throw new ApiError("رمز نادرست است", 403);
    throw new ApiError("دریافت فایل ناموفق بود", res.status);
  }
  return URL.createObjectURL(await res.blob());
}

/** Save an item to disk. */
export async function downloadFile(id, filename, password) {
  const url = await fetchFileURL(id, password);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "file";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Mirrors the chat-media helper: unchanged export kept for symmetry. */
export { request };
