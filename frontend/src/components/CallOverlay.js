import { useEffect, useRef, useState } from "react";
import Avatar from "./Avatar";
import { callManager, useCall } from "../services/calls";

const STATUS = {
  outgoing: "در حال تماس…",
  ringing: "در حال زنگ خوردن…",
  incoming: "تماس صوتی ورودی",
  connecting: "در حال اتصال…",
};

const END_REASON = {
  declined: "تماس رد شد",
  busy: "در تماس دیگری است",
  unavailable: "در حال حاضر در دسترس نیست",
  noAnswer: "پاسخی نداد",
  failed: "اتصال برقرار نشد",
  micDenied: "دسترسی به میکروفون داده نشد",
  answeredElsewhere: "روی دستگاه دیگری پاسخ داده شد",
};

function toFa(s) {
  return String(s).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return toFa(h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`);
}

function statusText(call, now) {
  if (call.phase === "active") return call.connectedAt ? formatDuration(now - call.connectedAt) : "";
  if (call.phase === "ended") return END_REASON[call.endReason] || "تماس پایان یافت";
  return STATUS[call.phase] || "";
}

/**
 * A soft two-tone ring built with Web Audio, so no audio file is shipped.
 * Browsers only allow sound after the page has had a click; if it has not,
 * this stays silent and the tab title / vibration carry the ring instead.
 */
function useRingtone(active, outgoing) {
  useEffect(() => {
    if (!active) return undefined;
    let ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return undefined;
    }
    const beep = () => {
      const pattern = outgoing ? [[440, 0, 0.4]] : [[880, 0, 0.18], [660, 0.22, 0.18]];
      for (const [freq, at, len] of pattern) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
        gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + at + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + len);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + at);
        osc.stop(ctx.currentTime + at + len + 0.05);
      }
      if (!outgoing) navigator.vibrate?.([300, 150, 300]);
    };
    beep();
    const t = setInterval(beep, outgoing ? 3000 : 1600);
    return () => {
      clearInterval(t);
      ctx.close?.();
    };
  }, [active, outgoing]);
}

/** Flashes the tab title while a call rings, for a tab in the background. */
function useTitleFlash(active, text) {
  useEffect(() => {
    if (!active) return undefined;
    const original = document.title;
    let on = false;
    const t = setInterval(() => {
      on = !on;
      document.title = on ? text : original;
    }, 1000);
    return () => {
      clearInterval(t);
      document.title = original;
    };
  }, [active, text]);
}

/** The call UI, mounted once for the whole signed-in app. */
export default function CallOverlay() {
  const call = useCall();
  const audioRef = useRef(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    callManager.attach();
    return () => callManager.detach();
  }, []);

  useEffect(() => {
    if (call.phase !== "active") return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [call.phase]);

  // Attach the remote audio whenever the stream appears or changes.
  useEffect(() => {
    const el = audioRef.current;
    if (el && callManager.remoteStream && el.srcObject !== callManager.remoteStream) {
      el.srcObject = callManager.remoteStream;
      el.play?.().catch(() => {});
    }
  });

  useRingtone(call.phase === "incoming" || call.phase === "ringing", call.phase === "ringing");
  useTitleFlash(call.phase === "incoming", `📞 ${call.peer || ""}`);

  if (call.phase === "idle") return <audio ref={audioRef} autoPlay />;

  const ringing = ["outgoing", "ringing", "incoming", "connecting"].includes(call.phase);
  const ended = call.phase === "ended";

  if (call.minimized && !ended) {
    return (
      <>
        <audio ref={audioRef} autoPlay />
        <button style={styles.bar} onClick={() => callManager.setMinimized(false)}>
          <span>📞</span>
          <span style={{ flex: 1, textAlign: "start", fontWeight: 700 }}>
            {call.peer} · {statusText(call, now)}
          </span>
          <span style={{ opacity: 0.85, fontSize: 13 }}>برای بازگشت بزنید</span>
        </button>
      </>
    );
  }

  return (
    <div style={styles.overlay} role="dialog" aria-label="تماس صوتی">
      <audio ref={audioRef} autoPlay />
      <style>{`
        @keyframes call-pulse { 0% { transform: scale(1); opacity: .55 } 100% { transform: scale(1.75); opacity: 0 } }
        @keyframes call-glow { 0%,100% { transform: scale(1) } 50% { transform: scale(1.05) } }
      `}</style>

      <div style={styles.top}>
        {!ended && call.phase !== "incoming" && (
          <button style={styles.minimize} onClick={() => callManager.setMinimized(true)} title="کوچک کردن">
            ⌄
          </button>
        )}
        <div style={styles.e2e}>🔒 رمزنگاری سرتاسری</div>
      </div>

      <div style={styles.center}>
        <div style={styles.avatarWrap}>
          {ringing &&
            [0, 0.6, 1.2].map((d) => (
              <span key={d} style={{ ...styles.ring, animationDelay: `${d}s` }} />
            ))}
          {call.phase === "active" && <span style={styles.glow} />}
          <div style={{ position: "relative" }}>
            <Avatar userId={call.peer} size={140} />
          </div>
        </div>
        <div style={styles.name}>{call.peer}</div>
        <div style={{ ...styles.status, color: call.phase === "active" ? "#34d399" : "rgba(255,255,255,.75)" }}>
          {statusText(call, now)}
        </div>
      </div>

      <div style={styles.controls}>
        {call.phase === "incoming" ? (
          <>
            <RoundButton label="رد کردن" color="#ef4444" icon="✕" onClick={() => callManager.decline()} />
            <RoundButton label="پذیرفتن" color="#10b981" icon="📞" onClick={() => callManager.accept()} big />
          </>
        ) : (
          <>
            <RoundButton
              label={call.muted ? "باصدا" : "بی‌صدا"}
              icon={call.muted ? "🔇" : "🎙️"}
              selected={call.muted}
              disabled={ended}
              onClick={() => callManager.toggleMute()}
            />
            <RoundButton label="پایان" color="#ef4444" icon="✕" big disabled={ended} onClick={() => callManager.hangUp()} />
          </>
        )}
      </div>
    </div>
  );
}

function RoundButton({ label, icon, color, onClick, big, selected, disabled }) {
  const size = big ? 76 : 62;
  return (
    <button onClick={onClick} disabled={disabled} style={{ ...styles.roundWrap, opacity: disabled ? 0.45 : 1 }}>
      <span
        style={{
          ...styles.round,
          width: size,
          height: size,
          fontSize: size * 0.4,
          background: color || (selected ? "#fff" : "rgba(255,255,255,.14)"),
          color: selected && !color ? "#111" : "#fff",
          boxShadow: color ? `0 10px 28px ${color}66` : "none",
        }}
      >
        {icon}
      </span>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
    </button>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 2000,
    display: "flex",
    flexDirection: "column",
    color: "#fff",
    background:
      "radial-gradient(circle at 20% 15%, rgba(29,111,232,.55), transparent 55%)," +
      "radial-gradient(circle at 85% 40%, rgba(67,182,73,.45), transparent 55%)," +
      "radial-gradient(circle at 40% 90%, rgba(20,184,166,.40), transparent 60%), #0a0a12",
    padding: "max(16px, env(safe-area-inset-top)) 16px max(28px, env(safe-area-inset-bottom))",
  },
  top: { display: "flex", alignItems: "center", gap: 8 },
  minimize: {
    background: "transparent",
    border: 0,
    color: "#fff",
    fontSize: 30,
    lineHeight: 1,
    cursor: "pointer",
    padding: "0 8px",
  },
  e2e: {
    marginInlineStart: "auto",
    fontSize: 12,
    fontWeight: 700,
    color: "#34d399",
    background: "rgba(16,185,129,.15)",
    padding: "6px 12px",
    borderRadius: 20,
  },
  center: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 },
  avatarWrap: { position: "relative", width: 240, height: 240, display: "grid", placeItems: "center", marginBottom: 16 },
  ring: {
    position: "absolute",
    width: 150,
    height: 150,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #1d6fe8, #43b649)",
    animation: "call-pulse 1.8s ease-out infinite",
  },
  glow: {
    position: "absolute",
    width: 168,
    height: 168,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #059669, #10b981)",
    animation: "call-glow 1.8s ease-in-out infinite",
  },
  name: { fontSize: 30, fontWeight: 800 },
  status: { fontSize: 17, fontWeight: 600, fontVariantNumeric: "tabular-nums" },
  controls: { display: "flex", justifyContent: "space-evenly", alignItems: "flex-start", paddingBottom: 12 },
  roundWrap: {
    background: "transparent",
    border: 0,
    color: "#fff",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    cursor: "pointer",
  },
  round: { borderRadius: "50%", display: "grid", placeItems: "center", transition: "transform .15s" },
  bar: {
    position: "fixed",
    top: "max(8px, env(safe-area-inset-top))",
    insetInline: 12,
    zIndex: 1500,
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 16px",
    border: 0,
    borderRadius: 18,
    color: "#fff",
    cursor: "pointer",
    background: "linear-gradient(135deg, #059669, #10b981)",
    boxShadow: "0 8px 22px rgba(16,185,129,.4)",
    fontFamily: "inherit",
  },
};
