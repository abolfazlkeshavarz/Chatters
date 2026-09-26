import { api } from "./client";

/** STUN / short-lived TURN servers for a WebRTC call. */
export async function getIceServers() {
  const data = await api.get("/api/calls/ice-servers");
  return data?.ice_servers || [];
}
