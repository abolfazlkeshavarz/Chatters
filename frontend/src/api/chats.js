import { api } from "./client";

export function getChats() {
  return api.get("/api/chats");
}

/**
 * The group name was previously accepted by callers but never sent, so every
 * group fell back to the server's auto-generated title.
 */
export function createChat(members, isGroup, name) {
  return api.post("/api/chats", {
    members,
    is_group: Boolean(isGroup),
    name: name || "",
  });
}

/**
 * Start (or reopen) a Telegram-style secret chat with one user. Unlike the old
 * in-place upgrade this creates a separate 1:1 chat, pending until the other
 * person accepts.
 */
export function createSecretChat(userId) {
  return api.post("/api/secret-chats", { user_id: userId });
}

/** Change a secret chat's self-destruct timer (seconds; 0 = off). */
export function setSelfDestruct(chatId, seconds) {
  return api.put(`/api/chats/${encodeURIComponent(chatId)}/self-destruct`, {
    seconds,
  });
}

/**
 * Delete a chat. scope "me" leaves it / drops it from your list; scope
 * "everyone" removes a one-to-one or secret chat for both sides.
 */
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

/**
 * Consent handshake for turning on end-to-end encryption. Neither side can
 * enable it alone: one side requests, the other accepts or rejects.
 */
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
