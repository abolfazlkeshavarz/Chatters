import { api } from "./client";

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
