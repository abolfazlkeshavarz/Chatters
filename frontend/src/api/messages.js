import { api } from "./client";

export function getMessages(chatId, limit) {
  const query = limit ? `?limit=${encodeURIComponent(limit)}` : "";
  return api.get(`/api/chats/${encodeURIComponent(chatId)}/messages${query}`);
}

/**
 * Delete a message. scope "me" hides it only for you; scope "everyone"
 * removes it for all members (allowed when you sent it, or in any secret chat).
 */
export function deleteMessage(messageId, scope = "me") {
  return api.del(`/api/messages/${encodeURIComponent(messageId)}`, { scope });
}
