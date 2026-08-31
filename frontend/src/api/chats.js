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
