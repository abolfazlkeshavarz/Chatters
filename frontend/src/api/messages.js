import { api } from "./client";

export function getMessages(chatId, limit) {
  const query = limit ? `?limit=${encodeURIComponent(limit)}` : "";
  return api.get(`/api/chats/${encodeURIComponent(chatId)}/messages${query}`);
}
