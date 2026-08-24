import { request, getToken } from "./client";

export function uploadMedia(chatId, file) {
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("file", file);

  return request("/api/media", { method: "POST", body: form });
}

/** Fetches an attachment as an object URL. Callers must revoke it when done. */
export async function fetchMediaURL(messageId) {
  const res = await fetch(`/api/media/${encodeURIComponent(messageId)}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!res.ok) throw new Error("Failed to download attachment");
  return URL.createObjectURL(await res.blob());
}
