import { api, getToken, ApiError } from "./client";

export function getStats() {
  return api.get("/api/admin/stats");
}

export function listUsers({ search = "", limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams({ search, limit, offset });
  return api.get(`/api/admin/users?${params}`);
}

export function createUser({ username, email, password, isAdmin }) {
  return api.post("/api/admin/users", {
    username,
    email,
    password,
    is_admin: Boolean(isAdmin),
  });
}

export function deleteUser(userId) {
  return api.del(`/api/admin/users/${encodeURIComponent(userId)}`);
}

export function resetPassword(userId, newPassword) {
  return api.put(`/api/admin/users/${encodeURIComponent(userId)}/password`, {
    new_password: newPassword,
  });
}

export function setRole(userId, isAdmin) {
  return api.put(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
    is_admin: isAdmin,
  });
}

export function getE2ERetention() {
  return api.get("/api/admin/settings/e2e-retention");
}

export function setE2ERetention(seconds) {
  return api.put("/api/admin/settings/e2e-retention", { retention_seconds: seconds });
}

export function purgeE2EMessages() {
  return api.post("/api/admin/e2e/purge-now");
}

/* ------------------------------------------------------- chat / message admin */

export function listChats({ search = "", limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams({ search, limit, offset });
  return api.get(`/api/admin/chats?${params}`);
}

export function getChatMessages(chatId, { limit = 200, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit, offset });
  return api.get(
    `/api/admin/chats/${encodeURIComponent(chatId)}/messages?${params}`
  );
}

export function deleteChatAdmin(chatId) {
  return api.del(`/api/admin/chats/${encodeURIComponent(chatId)}`);
}

export function deleteMessageAdmin(messageId) {
  return api.del(`/api/admin/messages/${encodeURIComponent(messageId)}`);
}

/**
 * Any chat attachment, bypassing the membership check the user-facing media
 * endpoint enforces. Returns an object URL the caller must revoke.
 */
export async function fetchAdminMediaURL(messageId) {
  const res = await fetch(`/api/admin/media/${encodeURIComponent(messageId)}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new ApiError("Failed to load attachment", res.status);
  return URL.createObjectURL(await res.blob());
}

/* ------------------------------------------------------------ user detail */

export function getUserDetail(userId) {
  return api.get(`/api/admin/users/${encodeURIComponent(userId)}/detail`);
}

export function setUserPhone(userId, phone) {
  return api.put(`/api/admin/users/${encodeURIComponent(userId)}/phone`, { phone });
}

/* Drill-downs behind the counters on the user detail view. */

export function getUserMessages(userId, { mediaOnly = false, limit = 200 } = {}) {
  const params = new URLSearchParams({ limit });
  if (mediaOnly) params.set("media", "1");
  return api.get(`/api/admin/users/${encodeURIComponent(userId)}/messages?${params}`);
}

export function getUserChats(userId) {
  return api.get(`/api/admin/users/${encodeURIComponent(userId)}/chats`);
}

export function getUserFiles(userId) {
  return api.get(`/api/admin/users/${encodeURIComponent(userId)}/files`);
}

/* --------------------------------------------------- registration requests */

export function listRegistrations(status = "pending") {
  return api.get(`/api/admin/registrations?status=${encodeURIComponent(status)}`);
}

export function approveRegistration(id, { verifyPhone = false, makeAdmin = false } = {}) {
  return api.post(`/api/admin/registrations/${encodeURIComponent(id)}/approve`, {
    verify_phone: verifyPhone,
    make_admin: makeAdmin,
  });
}

export function rejectRegistration(id, reason) {
  return api.post(`/api/admin/registrations/${encodeURIComponent(id)}/reject`, {
    reason: reason || "",
  });
}

export function deleteRegistration(id) {
  return api.del(`/api/admin/registrations/${encodeURIComponent(id)}`);
}

/* --------------------------------------------------------- phone requests */

export function listPhoneRequests(status = "pending") {
  return api.get(`/api/admin/phone-requests?status=${encodeURIComponent(status)}`);
}

export function approvePhoneRequest(id) {
  return api.post(`/api/admin/phone-requests/${encodeURIComponent(id)}/approve`);
}

export function rejectPhoneRequest(id, reason) {
  return api.post(`/api/admin/phone-requests/${encodeURIComponent(id)}/reject`, {
    reason: reason || "",
  });
}

/* ------------------------------------------------------------ file library */

export function listAdminFiles({ search = "", visibility = "" } = {}) {
  const params = new URLSearchParams({ search, visibility });
  return api.get(`/api/admin/files?${params}`);
}

/* ----------------------------------------------------------- announcements */

export function listAnnouncements() {
  return api.get("/api/admin/announcements");
}

export function createAnnouncement(payload) {
  return api.post("/api/admin/announcements", payload);
}

export function setAnnouncementActive(id, active) {
  return api.put(`/api/admin/announcements/${encodeURIComponent(id)}`, { active });
}

export function deleteAnnouncement(id) {
  return api.del(`/api/admin/announcements/${encodeURIComponent(id)}`);
}

export function getAnnouncementReaders(id) {
  return api.get(`/api/admin/announcements/${encodeURIComponent(id)}/readers`);
}

/* --------------------------------------------------------------- audit log */

export function getAuditLog({ action = "", limit = 100 } = {}) {
  const params = new URLSearchParams({ action, limit });
  return api.get(`/api/admin/audit?${params}`);
}
