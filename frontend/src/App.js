import { useCallback, useEffect, useState } from "react";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Home from "./pages/Home";
import { isLoggedIn, logout } from "./api/auth";
import { onSessionExpired } from "./api/client";
import { chatSocket } from "./services/websocket";

/**
 * Self-service signup is off, matching the "ظرفیت ها پر شد" notice the login
 * screen used to show. Administrators create accounts from the admin panel.
 * Flip this to true to reopen public registration.
 */
const REGISTRATION_OPEN = false;

export default function App() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn);
  const [page, setPage] = useState("login");
  const [initialChatId, setInitialChatId] = useState(null);

  const handleLoggedOut = useCallback(() => {
    chatSocket.stop();
    setLoggedIn(false);
    setPage("login");
  }, []);

  // The API layer signals a revoked or expired session from one place, so an
  // admin deleting an account or resetting a password logs that user out
  // rather than leaving them in a broken half-authenticated state.
  useEffect(() => onSessionExpired(handleLoggedOut), [handleLoggedOut]);

  // Open the conversation a notification pointed at, whether the app was
  // already running (postMessage from the service worker) or cold-started
  // through the ?chat= deep link.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const chat = params.get("chat");
    if (chat) {
      setInitialChatId(chat);
      window.history.replaceState({}, "", window.location.pathname);
    }

    if (!("serviceWorker" in navigator)) return;

    const onMessage = (event) => {
      if (event.data?.type === "open-chat" && event.data.chatId) {
        setInitialChatId(event.data.chatId);
      }
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  // Keep one socket for the whole authenticated session instead of opening a
  // fresh one per chat page.
  useEffect(() => {
    if (loggedIn) {
      chatSocket.start();
      return () => chatSocket.stop();
    }
    return undefined;
  }, [loggedIn]);

  if (loggedIn) {
    return (
      <Home
        initialChatId={initialChatId}
        onLogout={async () => {
          await logout();
          handleLoggedOut();
        }}
      />
    );
  }

  if (REGISTRATION_OPEN && page === "register") {
    return (
      <Register
        onRegister={() => setPage("login")}
        onBack={() => setPage("login")}
      />
    );
  }

  return (
    <Login
      onLogin={() => setLoggedIn(true)}
      onRegister={REGISTRATION_OPEN ? () => setPage("register") : null}
    />
  );
}
