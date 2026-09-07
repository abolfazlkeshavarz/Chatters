import { getToken, ApiError } from "./client";

/**
 * Upload an attachment, reporting progress as it goes.
 *
 * fetch() cannot report upload progress without request streaming (which Safari
 * still does not support), so this uses XHR. Returns { promise, abort }: await
 * the promise for the server's `{ message_id }`; call abort() to cancel an
 * in-flight upload.
 */
export function uploadMedia(chatId, file, { onProgress } = {}) {
  const xhr = new XMLHttpRequest();

  const promise = new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("file", file);

    xhr.open("POST", "/api/media");
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
        /* empty or non-JSON body is fine on some error paths */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve(data || {});
      } else {
        reject(
          new ApiError(
            (data && data.error) || `Upload failed (${xhr.status})`,
            xhr.status
          )
        );
      }
    };
    xhr.onerror = () => reject(new ApiError("Network error during upload", 0));
    xhr.onabort = () => reject(new ApiError("Upload cancelled", 0));

    xhr.send(form);
  });

  return { promise, abort: () => xhr.abort() };
}

/*
 * Downloaded attachments are cached as object URLs, keyed by message id.
 * Fetching one needs the bearer token, so <img src> / <video src> cannot point
 * straight at the endpoint — we download it once, hand out a blob URL, and
 * reuse that for every later render of the same message. A small cap keeps a
 * long scroll-back through an image-heavy chat from pinning unbounded memory.
 */
const MAX_CACHED = 60;
const mediaURLCache = new Map();
const inflight = new Map();

function remember(messageId, url) {
  mediaURLCache.set(messageId, url);
  while (mediaURLCache.size > MAX_CACHED) {
    const oldest = mediaURLCache.keys().next().value;
    releaseMediaURL(oldest);
  }
}

export function getMediaURL(messageId) {
  if (mediaURLCache.has(messageId)) {
    return Promise.resolve(mediaURLCache.get(messageId));
  }
  if (inflight.has(messageId)) return inflight.get(messageId);

  const p = fetch(`/api/media/${encodeURIComponent(messageId)}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
    .then(async (res) => {
      if (!res.ok) throw new ApiError("Failed to load attachment", res.status);
      const url = URL.createObjectURL(await res.blob());
      remember(messageId, url);
      return url;
    })
    .finally(() => inflight.delete(messageId));

  inflight.set(messageId, p);
  return p;
}

/** Revoke and forget a cached blob URL (e.g. once a message is deleted). */
export function releaseMediaURL(messageId) {
  const url = mediaURLCache.get(messageId);
  if (url) {
    URL.revokeObjectURL(url);
    mediaURLCache.delete(messageId);
  }
}

/** Save an attachment to disk without keeping it in the inline cache. */
export async function downloadMedia(messageId, filename) {
  const res = await fetch(`/api/media/${encodeURIComponent(messageId)}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new ApiError("Failed to download attachment", res.status);

  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "file";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Back-compat alias for callers that predate the cache. */
export const fetchMediaURL = getMediaURL;
