/**
 * Shared fetch wrapper. Same contract as the web app's api/client.js — attach
 * the bearer token, parse errors uniformly, signal a revoked session once — but
 * every path is prefixed with the absolute API base and the token is read from
 * the in-memory storage cache instead of localStorage.
 */

import { API_BASE } from "../config";
import { getToken, clearSession } from "../storage";

const listeners = new Set();

/** Subscribe to forced logout (token expired, or revoked by an admin). */
export function onSessionExpired(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function sessionExpired() {
  clearSession();
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a broken listener must not stop the others */
    }
  });
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function apiUrl(path) {
  if (/^https?:\/\//.test(path)) return path;
  return API_BASE + (path.startsWith("/") ? path : `/${path}`);
}

/** Bearer header for the current session, or an empty object. */
export function authHeader() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function request(
  path,
  { method = "GET", body, auth = true, raw = false } = {}
) {
  const headers = {};
  if (auth) Object.assign(headers, authHeader());

  let payload;
  if (body instanceof FormData) {
    payload = body; // RN sets the multipart boundary itself
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const res = await fetch(apiUrl(path), { method, headers, body: payload });

  if (res.status === 401 && auth) {
    sessionExpired();
    throw new ApiError("Your session has expired. Please sign in again.", 401);
  }

  if (raw) {
    if (!res.ok) throw new ApiError("Request failed", res.status);
    return res;
  }

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
