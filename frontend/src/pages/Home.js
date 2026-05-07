import { useState } from "react";
import ChatList from "./ChatList";
import Profile from "./Profile";

export default function Home({ onLogout }) {
  const [tab, setTab] = useState("chats");

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        {tab === "chats" && <ChatList />}
        {tab === "profile" && <Profile onLogout={onLogout} />}
      </div>

      <div style={styles.nav}>
        <button
          style={tab === "chats" ? styles.active : styles.navBtn}
          onClick={() => setTab("chats")}
        >
          💬 چت ها
        </button>
        <button
          style={tab === "profile" ? styles.active : styles.navBtn}
          onClick={() => setTab("profile")}
        >
          👤 پروفایل
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
  },
  content: {
    flex: 1,
    overflowY: "auto",
  },
  nav: {
    display: "flex",
    borderTop: "1px solid var(--border)",
    background: "#fff",
  },
  navBtn: {
    flex: 1,
    padding: 12,
    border: "none",
    background: "none",
    fontSize: 14,
  },
  active: {
    flex: 1,
    padding: 12,
    border: "none",
    background: "#eef3ff",
    color: "var(--primary)",
    fontWeight: 500,
  },
};
