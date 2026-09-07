import { api } from "./client";

export function getContacts() {
  return api.get("/api/contacts");
}

/**
 * Add by username, or by phone number when `phone` is passed. Only a number an
 * administrator has verified resolves to an account — an unverified one is
 * just text the owner typed about themselves.
 */
export function addContact(username, phone) {
  return api.post("/api/contacts", phone ? { phone } : { username });
}

export function removeContact(userId) {
  return api.del(`/api/contacts/${encodeURIComponent(userId)}`);
}
