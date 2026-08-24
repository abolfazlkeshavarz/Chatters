/**
 * Shared fetch wrapper: attaches the bearer token, parses errors uniformly,
 * and reacts to a revoked session in one place instead of in every caller.
 */

const listeners = new Set();

/** Subscribe to forced logout (token expired, or revoked by an admin). */
export function onSessionExpired(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function sessionExpired() {
  localStorage.removeItem("token");
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a broken listener must not stop the others */
    }
  });
}

export function getToken() {
  return localStorage.getItem("token");
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function request(path, { method = "GET", body, auth = true, raw = false } = {}) {
  const headers = {};
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let payload;
  if (body instanceof FormData) {
    payload = body; // let the browser set the multipart boundary
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const res = await fetch(path, { method, headers, body: payload });

  if (res.status === 401 && auth) {
    sessionExpired();
    throw new ApiError("Your session has expired. Please sign in again.", 401);
  }

  if (raw) {
    if (!res.ok) throw new ApiError("Request failed", res.status);
    return res;
  }

  // 204 and empty bodies are legitimate successes.
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    throw new ApiError(
      (data && data.error) || `Request failed (${res.status})`,
      res.status
    );
  }

  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: "POST", body }),
  put: (path, body) => request(path, { method: "PUT", body }),
  del: (path, body) => request(path, { method: "DELETE", body }),
};
