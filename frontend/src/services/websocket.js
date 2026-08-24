/**
 * Resilient WebSocket client.
 *
 * The original implementation opened a socket once and never noticed when it
 * died. On mobile the OS suspends the tab as soon as you switch apps, the
 * socket is torn down, and on returning the page held a permanently closed
 * connection — which is why new messages only appeared after force-quitting
 * and reopening the app.
 *
 * This version:
 *   - reconnects automatically with exponential backoff and jitter,
 *   - reconnects immediately when the tab becomes visible or the network
 *     comes back, which is exactly the app-switch case,
 *   - sends an application-level heartbeat and forces a reconnect when the
 *     server stops answering, so a silently-dead socket is detected instead
 *     of being trusted forever,
 *   - notifies subscribers on every (re)connect so they can refetch anything
 *     missed while offline.
 */

import { api } from "../api/client";

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

    this.onVisibility = this.onVisibility.bind(this);
    this.onOnline = this.onOnline.bind(this);
  }

  /* ------------------------------------------------------------ lifecycle */

  start() {
    if (this.started) return;
    this.started = true;
    this.closing = false;

    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("online", this.onOnline);
    window.addEventListener("focus", this.onOnline);
    // Fires when a page is restored from the back/forward cache, which is how
    // iOS Safari often resumes a PWA.
    window.addEventListener("pageshow", this.onOnline);

    this.connect();
  }

  stop() {
    this.started = false;
    this.closing = true;

    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("focus", this.onOnline);
    window.removeEventListener("pageshow", this.onOnline);

    this.clearTimers();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.setStatus("offline");
  }

  onVisibility() {
    if (document.visibilityState === "visible") this.ensureAlive();
  }

  onOnline() {
    this.ensureAlive();
  }

  /**
   * Called whenever the app comes back to the foreground. A socket can be in
   * CLOSED state without us having been told, so check rather than assume.
   */
  ensureAlive() {
    if (!this.started || this.closing) return;

    const state = this.ws ? this.ws.readyState : WebSocket.CLOSED;
    if (state === WebSocket.OPEN) {
      // Looks open, but it may be a zombie the OS killed while suspended.
      // Prove it with a heartbeat instead of trusting readyState.
      this.ping();
      return;
    }
    if (state === WebSocket.CONNECTING) return;

    // Coming back to the foreground is a strong signal, so retry now rather
    // than waiting out whatever backoff was pending.
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
      // Short-lived single-use credential; the bearer token never goes in a URL.
      const res = await api.post("/api/ws-ticket");
      ticket = res.ticket;
    } catch (err) {
      this.connecting = false;
      // 401 means the session is gone; client.js has already signalled that,
      // so stop hammering the endpoint.
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

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${protocol}://${window.location.host}/api/ws?ticket=${encodeURIComponent(ticket)}`;

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
      // Tell subscribers to resync: anything sent while we were away was
      // missed by this socket and has to come from the REST endpoint.
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
      // 1s, 2s, 4s … capped, plus jitter so many clients returning at once
      // (e.g. after a server restart) do not synchronise into a thundering herd.
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
    if (this.pongTimer) return; // one outstanding probe at a time

    try {
      this.ws.send(JSON.stringify({ type: "ping" }));
    } catch {
      this.forceReconnect();
      return;
    }

    this.pongTimer = setTimeout(() => {
      this.pongTimer = null;
      // No reply: the connection is dead even though readyState says OPEN.
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

  /** Receives "reconnected" plus status strings: online/reconnecting/offline. */
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
