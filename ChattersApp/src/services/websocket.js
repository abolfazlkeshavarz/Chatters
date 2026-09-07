/**
 * Resilient WebSocket client — the same design as the web app's
 * services/websocket.js, with the browser lifecycle signals swapped for their
 * React Native equivalents:
 *
 *   visibilitychange / focus / pageshow  ->  AppState "active"
 *   window "online"                       ->  NetInfo reachability
 *
 * It reconnects with exponential backoff + jitter, reconnects immediately when
 * the app is foregrounded or the network returns, heartbeats to detect a
 * silently-dead socket, and tells subscribers on every (re)connect so they can
 * refetch whatever was missed while backgrounded.
 */

import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";

import { api } from "../api/client";
import { WS_BASE } from "../config";

const HEARTBEAT_INTERVAL = 20000;
const HEARTBEAT_TIMEOUT = 10000;
const MAX_BACKOFF = 30000;

class ChatSocket {
  constructor() {
    this.ws = null;
    this.messageHandlers = new Set();
    this.statusHandlers = new Set();

    this.attempts = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.pongTimer = null;

    this.started = false;
    this.closing = false;
    this.connecting = false;
    this.status = "offline";

    this.appStateSub = null;
    this.netInfoSub = null;
    this.wasConnected = true;

    this.onAppStateChange = this.onAppStateChange.bind(this);
    this.onNetInfo = this.onNetInfo.bind(this);
  }

  /* ------------------------------------------------------------ lifecycle */

  start() {
    if (this.started) return;
    this.started = true;
    this.closing = false;

    this.appStateSub = AppState.addEventListener("change", this.onAppStateChange);
    this.netInfoSub = NetInfo.addEventListener(this.onNetInfo);

    this.connect();
  }

  stop() {
    this.started = false;
    this.closing = true;

    this.appStateSub?.remove();
    this.appStateSub = null;
    this.netInfoSub?.();
    this.netInfoSub = null;

    this.clearTimers();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.setStatus("offline");
  }

  onAppStateChange(state) {
    if (state === "active") this.ensureAlive();
  }

  onNetInfo(state) {
    const connected = Boolean(state.isConnected);
    // Only act on the transition back to connected, mirroring the web's
    // "online" event rather than firing on every NetInfo tick.
    if (connected && !this.wasConnected) this.ensureAlive();
    this.wasConnected = connected;
  }

  ensureAlive() {
    if (!this.started || this.closing) return;

    const state = this.ws ? this.ws.readyState : WebSocket.CLOSED;
    if (state === WebSocket.OPEN) {
      this.ping();
      return;
    }
    if (state === WebSocket.CONNECTING) return;

    this.attempts = 0;
    this.scheduleReconnect(0);
  }

  /* ----------------------------------------------------------- connection */

  async connect() {
    if (this.closing || this.connecting) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    this.connecting = true;
    this.setStatus(this.attempts === 0 ? "connecting" : "reconnecting");

    let ticket;
    try {
      const res = await api.post("/api/ws-ticket");
      ticket = res.ticket;
    } catch (err) {
      this.connecting = false;
      if (err && err.status === 401) {
        this.stop();
        return;
      }
      this.scheduleReconnect();
      return;
    }

    if (this.closing) {
      this.connecting = false;
      return;
    }

    const url = `${WS_BASE}/api/ws?ticket=${encodeURIComponent(ticket)}`;

    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      this.connecting = false;
      this.scheduleReconnect();
      return;
    }

    this.ws = ws;

    ws.onopen = () => {
      this.connecting = false;
      this.attempts = 0;
      this.setStatus("online");
      this.startHeartbeat();
      this.statusHandlers.forEach((fn) => fn("reconnected"));
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === "pong") {
        this.clearPongTimer();
        return;
      }

      this.messageHandlers.forEach((fn) => {
        try {
          fn(msg);
        } catch (err) {
          console.error("websocket handler failed", err);
        }
      });
    };

    ws.onerror = () => {
      // onclose always follows; reconnect is handled there.
    };

    ws.onclose = () => {
      this.connecting = false;
      this.clearTimers();
      if (this.ws === ws) this.ws = null;
      if (this.closing) return;

      this.setStatus("reconnecting");
      this.scheduleReconnect();
    };
  }

  scheduleReconnect(delayOverride) {
    if (this.closing || this.reconnectTimer) return;

    let delay = delayOverride;
    if (delay === undefined) {
      const base = Math.min(1000 * 2 ** this.attempts, MAX_BACKOFF);
      delay = base + Math.random() * 1000;
      this.attempts++;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /* ------------------------------------------------------------ heartbeat */

  startHeartbeat() {
    this.clearTimers();
    this.heartbeatTimer = setInterval(() => this.ping(), HEARTBEAT_INTERVAL);
  }

  ping() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.pongTimer) return;

    try {
      this.ws.send(JSON.stringify({ type: "ping" }));
    } catch {
      this.forceReconnect();
      return;
    }

    this.pongTimer = setTimeout(() => {
      this.pongTimer = null;
      this.forceReconnect();
    }, HEARTBEAT_TIMEOUT);
  }

  clearPongTimer() {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  forceReconnect() {
    if (this.closing) return;
    this.clearTimers();

    if (this.ws) {
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {
        /* already gone */
      }
      this.ws = null;
    }

    this.setStatus("reconnecting");
    this.attempts = 0;
    this.scheduleReconnect(0);
  }

  clearTimers() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clearPongTimer();
  }

  /* --------------------------------------------------------------- public */

  send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  onMessage(fn) {
    this.messageHandlers.add(fn);
    return () => this.messageHandlers.delete(fn);
  }

  onStatus(fn) {
    this.statusHandlers.add(fn);
    fn(this.status);
    return () => this.statusHandlers.delete(fn);
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.statusHandlers.forEach((fn) => fn(status));
  }
}

export const chatSocket = new ChatSocket();
