import { api } from "./client";

export function getChats() {
  return api.get("/api/chats");
}

export function createChat(members, isGroup, name) {
  return api.post("/api/chats", {
    members,
    is_group: Boolean(isGroup),
    name: name || "",
  });
}

/** Start (or reopen) a Telegram-style secret chat with one user. */
export function createSecretChat(userId) {
  return api.post("/api/secret-chats", { user_id: userId });
}

/** Change a secret chat's self-destruct timer (seconds; 0 = off). */
export function setSelfDestruct(chatId, seconds) {
  return api.put(`/api/chats/${encodeURIComponent(chatId)}/self-destruct`, {
    seconds,
  });
}

/** scope "me" leaves the chat; "everyone" deletes a 1:1 / secret chat for both. */
export function deleteChat(chatId, scope = "me") {
  return api.del(`/api/chats/${encodeURIComponent(chatId)}`, { scope });
}

export function getChatMembers(chatId) {
  return api.get(`/api/chats/${encodeURIComponent(chatId)}/members`);
}

export function addMember(chatId, userId) {
  return api.post(`/api/chats/${encodeURIComponent(chatId)}/members`, {
    user_id: userId,
  });
}

/** Public keys of every member, for encrypting a message to the whole chat. */
export function getChatKeys(chatId) {
  return api.get(`/api/chats/${encodeURIComponent(chatId)}/keys`);
}

export function requestE2E(chatId) {
  return api.post(`/api/chats/${encodeURIComponent(chatId)}/e2e/request`);
}

export function acceptE2E(chatId) {
  return api.post(`/api/chats/${encodeURIComponent(chatId)}/e2e/accept`);
}

export function rejectE2E(chatId) {
  return api.post(`/api/chats/${encodeURIComponent(chatId)}/e2e/reject`);
}

export function setChatMute(chatId, muted) {
  return api.put(`/api/chats/${encodeURIComponent(chatId)}/mute`, { muted });
}
