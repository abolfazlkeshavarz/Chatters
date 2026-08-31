import { api } from "./client";

export function getContacts() {
  return api.get("/api/contacts");
}

export function addContact(username) {
  return api.post("/api/contacts", { username });
}

export function removeContact(userId) {
  return api.del(`/api/contacts/${encodeURIComponent(userId)}`);
}
