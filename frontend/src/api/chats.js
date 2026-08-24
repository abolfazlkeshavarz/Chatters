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

export function enableE2E(chatId) {
  return api.put(`/api/chats/${encodeURIComponent(chatId)}/e2e`, {
    enabled: true,
  });
}
