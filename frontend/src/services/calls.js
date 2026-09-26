/**
 * One 1:1 voice call at a time over WebRTC — the web twin of the apps'
 * CallService, speaking the same signaling so a browser and a phone can call
 * each other. The server only relays the call_* messages over the existing
 * WebSocket (backend: internal/websocket/calls.go); audio goes browser to
 * phone, relayed by TURN when there is no direct path, always encrypted by
 * WebRTC (DTLS-SRTP).
 */

import { useEffect, useState } from "react";

import { chatSocket } from "./websocket";
import { getIceServers } from "../api/calls";

const randomId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");

const initialState = () => ({
  phase: "idle", // idle | outgoing | ringing | incoming | connecting | active | ended
  endReason: null,
  callId: null,
  chatId: null,
  peer: null,
  outgoing: false,
  muted: false,
  connectedAt: null,
  minimized: false,
});

class CallManager {
  constructor() {
    this.deviceId = randomId();
    this.state = initialState();
    this.listeners = new Set();
    this.pc = null;
    this.local = null;
    this.remoteStream = null;
    this.peerDevice = null;
    this.pendingOffer = null;
    this.pendingIce = [];
    this.remoteSet = false;
    this.timeout = null;
    this.endTimer = null;
    this.unsub = null;
  }

  /** Start listening for call signaling (once, after sign-in). */
  attach() {
    if (!this.unsub) this.unsub = chatSocket.onMessage((m) => this.onSocket(m));
  }

  detach() {
    this.unsub?.();
    this.unsub = null;
    if (this.busy) this.hangUp();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn(this.state));
  }

  get busy() {
    return !["idle", "ended"].includes(this.state.phase);
  }

  me() {
    return localStorage.getItem("username");
  }

  /* ------------------------------------------------------------- outgoing */

  async start(chatId, peer) {
    if (this.busy) {
      this.set({ minimized: false });
      return;
    }
    this.reset();
    this.set({ ...initialState(), phase: "outgoing", chatId, peer, outgoing: true, callId: randomId() });
    try {
      await this.createPeer();
      const offer = await this.pc.createOffer({ offerToReceiveAudio: true });
      await this.pc.setLocalDescription(offer);
      this.send("call_offer", { sdp: offer.sdp, sdp_type: offer.type });
      this.timeout = setTimeout(() => {
        if (["outgoing", "ringing"].includes(this.state.phase)) {
          this.send("call_end");
          this.finish("noAnswer");
        }
      }, 45000);
    } catch (err) {
      console.warn("call start failed", err);
      this.send("call_end");
      this.finish(err?.name === "NotAllowedError" ? "micDenied" : "failed");
    }
  }

  /* ------------------------------------------------------------- incoming */

  async accept() {
    if (this.state.phase !== "incoming" || !this.pendingOffer) return;
    this.set({ phase: "connecting" });
    try {
      await this.createPeer();
      const offer = this.pendingOffer;
      await this.pc.setRemoteDescription({ type: offer.sdp_type || "offer", sdp: offer.sdp });
      this.remoteSet = true;
      await this.flushIce();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.send("call_answer", { sdp: answer.sdp, sdp_type: answer.type });
      this.armConnectTimeout();
    } catch (err) {
      console.warn("call accept failed", err);
      this.send("call_end");
      this.finish(err?.name === "NotAllowedError" ? "micDenied" : "failed");
    }
  }

  decline() {
    if (this.state.phase !== "incoming") return;
    this.send("call_reject");
    this.finish("declined");
  }

  hangUp() {
    if (!this.busy) return;
    if (this.state.phase === "incoming") return this.decline();
    this.send("call_end");
    this.finish(this.state.outgoing && !this.state.connectedAt ? "cancelled" : "hangup");
  }

  toggleMute() {
    const muted = !this.state.muted;
    this.local?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
    this.set({ muted });
  }

  setMinimized(minimized) {
    this.set({ minimized });
  }

  /* --------------------------------------------------------------- WebRTC */

  async createPeer() {
    if (!navigator.mediaDevices?.getUserMedia) {
      const err = new Error("Microphone access needs HTTPS");
      err.name = "NotSupportedError";
      throw err;
    }
    // Ask for the microphone first: a denied prompt should fail fast,
    // before anything is sent to the other side's phone.
    this.local = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    const iceServers = await getIceServers();
    this.pc = new RTCPeerConnection({ iceServers });
    this.local.getTracks().forEach((t) => this.pc.addTrack(t, this.local));

    this.remoteStream = new MediaStream();
    this.pc.ontrack = (e) => {
      e.streams[0]?.getTracks().forEach((t) => this.remoteStream.addTrack(t));
      if (!e.streams[0]) this.remoteStream.addTrack(e.track);
      this.set({}); // let the overlay attach the stream to its <audio>
    };
    this.pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      this.send("call_ice", {
        candidate: {
          candidate: e.candidate.candidate,
          sdpMid: e.candidate.sdpMid,
          sdpMLineIndex: e.candidate.sdpMLineIndex,
        },
      });
    };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc?.connectionState;
      if (s === "connected" && this.state.phase !== "active") {
        clearTimeout(this.timeout);
        this.set({ phase: "active", connectedAt: Date.now() });
      } else if (s === "failed") {
        this.send("call_end");
        this.finish("failed");
      }
    };
  }

  armConnectTimeout() {
    clearTimeout(this.timeout);
    this.timeout = setTimeout(() => {
      if (this.state.phase === "connecting") {
        this.send("call_end");
        this.finish("failed");
      }
    }, 30000);
  }

  async flushIce() {
    for (const c of this.pendingIce) {
      try {
        await this.pc?.addIceCandidate(c);
      } catch {
        /* a stale candidate is harmless */
      }
    }
    this.pendingIce = [];
  }

  /* ------------------------------------------------------------ signaling */

  send(type, extra = {}) {
    const { chatId, callId } = this.state;
    if (!chatId || !callId) return;
    chatSocket.send({ type, chat_id: chatId, call_id: callId, device_id: this.deviceId, ...extra });
  }

  async onSocket(msg) {
    const type = msg.type || "";
    if (!type.startsWith("call_")) return;
    if (msg.device_id && msg.device_id === this.deviceId) return; // own echo
    const mine = msg.from === this.me();

    if (type === "call_offer" && !mine) {
      if (this.busy) {
        chatSocket.send({ type: "call_busy", chat_id: msg.chat_id, call_id: msg.call_id, device_id: this.deviceId });
        return;
      }
      this.reset();
      this.peerDevice = msg.device_id;
      this.pendingOffer = msg;
      this.set({
        ...initialState(),
        phase: "incoming",
        callId: msg.call_id,
        chatId: msg.chat_id,
        peer: msg.from,
      });
      this.send("call_ringing");
      this.timeout = setTimeout(() => {
        if (this.state.phase === "incoming") this.finish("noAnswer");
      }, 50000);
      return;
    }

    if (!msg.call_id || msg.call_id !== this.state.callId) return;

    // Answered or declined on another of this user's devices.
    if (mine) {
      if (this.state.phase === "incoming" && (type === "call_answer" || type === "call_reject")) {
        this.finish("answeredElsewhere");
      }
      return;
    }

    switch (type) {
      case "call_ringing":
        if (this.state.phase === "outgoing") this.set({ phase: "ringing" });
        break;
      case "call_answer":
        if (!this.state.outgoing || this.remoteSet) return;
        this.peerDevice = msg.device_id;
        clearTimeout(this.timeout);
        this.set({ phase: "connecting" });
        await this.pc?.setRemoteDescription({ type: msg.sdp_type || "answer", sdp: msg.sdp });
        this.remoteSet = true;
        await this.flushIce();
        this.armConnectTimeout();
        break;
      case "call_ice": {
        if (this.peerDevice && msg.device_id !== this.peerDevice) return;
        const c = msg.candidate;
        if (!c) return;
        if (this.remoteSet) {
          try {
            await this.pc?.addIceCandidate(c);
          } catch {
            /* ignore */
          }
        } else {
          this.pendingIce.push(c);
        }
        break;
      }
      case "call_reject":
        if (this.state.outgoing) this.finish("declined");
        break;
      case "call_busy":
        if (this.state.outgoing) this.finish("busy");
        break;
      case "call_unavailable":
        if (this.state.outgoing) this.finish("unavailable");
        break;
      case "call_end":
        this.finish(this.state.phase === "incoming" ? "cancelled" : "remoteHangup");
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------ lifecycle */

  finish(reason) {
    if (!this.busy) return;
    clearTimeout(this.timeout);
    this.teardown();
    this.set({ phase: "ended", endReason: reason, minimized: false });
    this.endTimer = setTimeout(() => {
      if (this.state.phase === "ended") this.set(initialState());
    }, 2500);
  }

  teardown() {
    this.local?.getTracks().forEach((t) => t.stop());
    try {
      this.pc?.close();
    } catch {
      /* already closed */
    }
    this.local = null;
    this.pc = null;
  }

  reset() {
    clearTimeout(this.endTimer);
    clearTimeout(this.timeout);
    this.teardown();
    this.remoteStream = null;
    this.peerDevice = null;
    this.pendingOffer = null;
    this.pendingIce = [];
    this.remoteSet = false;
  }
}

export const callManager = new CallManager();

/** The call's live state, for React. */
export function useCall() {
  const [state, setState] = useState(callManager.state);
  useEffect(() => callManager.subscribe(setState), []);
  return state;
}
