import { api } from "./client";

/**
 * A phone number is how other people find you, so it is not self-service:
 * these endpoints file a request, and an administrator turns it into a
 * verified number from the panel.
 */

export function requestPhone(phone, note) {
  return api.post("/api/profile/phone", { phone, note: note || "" });
}

export function getMyPhoneRequest() {
  return api.get("/api/profile/phone/request");
}

export function cancelPhoneRequest() {
  return api.del("/api/profile/phone/request");
}

export function removeMyPhone() {
  return api.del("/api/profile/phone");
}
