import { useEffect, useState } from "react";
import { getDeveloperInfo, markDeveloperSeen } from "../api/developer";

// Same content as the apps' "Developer & news" page: who makes Chatters, how
// to reach them, and news posts. Written from Admin → Developer page.

const CONTACTS = {
  email: { icon: "✉️", name: "ایمیل", colors: ["#f97316", "#e11d48"] },
  phone: { icon: "📞", name: "تلفن", colors: ["#059669", "#10b981"] },
  whatsapp: { icon: "💬", name: "WhatsApp", colors: ["#16a34a", "#22c55e"] },
  website: { icon: "🌐", name: "وب‌سایت", colors: ["#2563eb", "#06b6d4"] },
  telegram: { icon: "✈️", name: "Telegram", colors: ["#0ea5e9", "#38bdf8"] },
  instagram: { icon: "📷", name: "Instagram", colors: ["#d946ef", "#f97316"] },
  github: { icon: "💻", name: "GitHub", colors: ["#334155", "#0f172a"] },
  linkedin: { icon: "💼", name: "LinkedIn", colors: ["#0a66c2", "#2563eb"] },
  x: { icon: "𝕏", name: "X", colors: ["#111827", "#374151"] },
  other: { icon: "🔗", name: "", colors: ["#1d6fe8", "#43b649"] },
};

function contactHref(c) {
  const v = (c.value || "").trim();
  const handle = v.replace(/^@/, "");
  const isUrl = /^https?:\/\//i.test(v);
  switch (c.kind) {
    case "email":
      return `mailto:${v}`;
    case "phone":
      return `tel:${v.replace(/[^0-9+]/g, "")}`;
    case "whatsapp":
      return `https://wa.me/${v.replace(/[^0-9]/g, "")}`;
    case "website":
      return isUrl ? v : `https://${v}`;
    case "telegram":
      return isUrl ? v : `https://t.me/${handle}`;
    case "instagram":
      return isUrl ? v : `https://instagram.com/${handle}`;
    case "github":
      return isUrl ? v : `https://github.com/${handle}`;
    case "linkedin":
      return isUrl ? v : `https://linkedin.com/in/${handle}`;
    case "x":
      return isUrl ? v : `https://x.com/${handle}`;
    default:
      return isUrl ? v : null;
  }
}

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return "";
  }
}

export default function News({ onSeen }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getDeveloperInfo()
      .then((d) => {
        setInfo(d);
        markDeveloperSeen(d.latest_at);
        onSeen?.();
      })
      .catch((e) => setError(e.message));
  }, [onSeen]);

  if (error) return <div className="container error-text">{error}</div>;
  if (!info) return <div className="container muted">در حال بارگذاری…</div>;

  const p = info.profile || {};
  const posts = info.posts || [];

  return (
    <div className="container stack" style={{ gap: 16, paddingBottom: 32 }}>
      <div style={styles.hero}>
        <img src="/app-icon.png" alt="" style={styles.logo} />
        <div dir="auto" style={styles.name}>{p.name || "Chatters"}</div>
        {p.headline && <div dir="auto" className="muted" style={{ fontWeight: 600 }}>{p.headline}</div>}
        {p.bio && (
          <div dir="auto" style={styles.bio}>
            {p.bio}
          </div>
        )}
        {(p.contacts || []).length > 0 && (
          <div style={styles.contacts}>
            {p.contacts.map((c, i) => {
              const meta = CONTACTS[c.kind] || CONTACTS.other;
              const href = contactHref(c);
              const label = c.label || meta.name || c.value;
              const body = (
                <>
                  <span style={{ ...styles.contactIcon, background: `linear-gradient(135deg, ${meta.colors[0]}, ${meta.colors[1]})` }}>
                    {meta.icon}
                  </span>
                  <span style={{ fontWeight: 700 }}>{label}</span>
                </>
              );
              return href ? (
                <a key={i} href={href} target="_blank" rel="noopener noreferrer" style={styles.contact} title={c.value}>
                  {body}
                </a>
              ) : (
                <button
                  key={i}
                  style={styles.contact}
                  title="کپی"
                  onClick={() => navigator.clipboard?.writeText(c.value)}
                >
                  {body}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <h3 style={styles.newsTitle}>اخبار</h3>
      {posts.length === 0 && <div className="muted" style={{ textAlign: "center", padding: 24 }}>هنوز خبری نیست</div>}
      {posts.map((post) => (
        <div
          key={post.id}
          className="card"
          style={{ display: "flex", gap: 12, borderColor: post.pinned ? "var(--primary)" : undefined }}
        >
          <div style={styles.emoji}>{post.emoji || "📢"}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
              {post.pinned && "📌 "}
              {formatDate(post.created_at)}
            </div>
            {post.title && (
              <div dir="auto" style={{ fontWeight: 700, fontSize: 16, marginTop: 2 }}>
                {post.title}
              </div>
            )}
            {post.body && (
              <div dir="auto" style={{ whiteSpace: "pre-wrap", marginTop: 6, lineHeight: 1.7 }}>
                {post.body}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

const styles = {
  hero: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    textAlign: "center",
    padding: "28px 16px 20px",
    borderRadius: 24,
    background:
      "radial-gradient(circle at 15% 20%, rgba(29,111,232,.25), transparent 60%)," +
      "radial-gradient(circle at 85% 70%, rgba(67,182,73,.22), transparent 60%), var(--card)",
    border: "1px solid var(--border)",
  },
  logo: { width: 88, height: 88, borderRadius: 24, boxShadow: "0 12px 30px rgba(29,111,232,.3)", marginBottom: 8 },
  name: { fontSize: 24, fontWeight: 800 },
  bio: { marginTop: 8, lineHeight: 1.8, maxWidth: 520 },
  contacts: { display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 14 },
  contact: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 14px 6px 6px",
    borderRadius: 22,
    border: "1px solid var(--border)",
    background: "var(--card)",
    color: "var(--text)",
    textDecoration: "none",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 14,
  },
  contactIcon: {
    width: 30,
    height: 30,
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    color: "#fff",
    fontSize: 15,
  },
  newsTitle: { margin: "8px 4px 0" },
  emoji: {
    width: 44,
    height: 44,
    borderRadius: 14,
    display: "grid",
    placeItems: "center",
    fontSize: 22,
    background: "var(--unread-bg)",
    flexShrink: 0,
  },
};
