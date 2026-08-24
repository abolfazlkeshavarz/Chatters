import { useEffect, useState } from "react";
import ChatList from "./ChatList";
import Profile from "./Profile";
import Admin from "./Admin";
import { getMe } from "../api/auth";

export default function Home({ onLogout, initialChatId }) {
  const [tab, setTab] = useState("chats");
  const [admin, setAdmin] = useState(localStorage.getItem("is_admin") === "1");

  // Confirm the role with the server rather than trusting localStorage, which
  // the user can edit. The admin API is gated server-side regardless; this
  // only decides whether the tab is worth showing.
  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((me) => {
        if (cancelled) return;
        setAdmin(Boolean(me.is_admin));
        localStorage.setItem("is_admin", me.is_admin ? "1" : "0");
      })
      .catch(() => {
        /* the auth layer handles an expired session */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A tapped notification jumps straight to the conversation.
  useEffect(() => {
    if (initialChatId) setTab("chats");
  }, [initialChatId]);

  const tabs = [
    { id: "chats", label: "💬 چت‌ها" },
    { id: "profile", label: "👤 پروفایل" },
    ...(admin ? [{ id: "admin", label: "🛠️ مدیریت" }] : []),
  ];

  return (
    <div className="app-shell">
      <div className="app-content">
        {tab === "chats" && <ChatList initialChatId={initialChatId} />}

        {/* Full-page views scroll as a whole, unlike the chat pane. */}
        {tab === "profile" && (
          <div className="scroll-area" style={{ height: "100%" }}>
            <Profile onLogout={onLogout} />
          </div>
        )}
        {tab === "admin" && admin && (
          <div className="scroll-area" style={{ height: "100%" }}>
            <Admin />
          </div>
        )}
      </div>

      <nav className="tabbar">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
