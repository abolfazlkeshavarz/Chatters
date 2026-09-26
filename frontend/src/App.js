import { useCallback, useEffect, useState } from "react";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Home from "./pages/Home";
import { isLoggedIn, logout } from "./api/auth";
import { onSessionExpired } from "./api/client";
import { chatSocket } from "./services/websocket";
import UpdateBanner from "./components/UpdateBanner";
import CallOverlay from "./components/CallOverlay";

/**
 * Public signup is open, but it does not create an account: the form files a
 * request that an administrator approves or rejects from the panel. Nobody
 * gets in without a decision, so this being true is not the same as the
 * unmoderated signup it used to mean.
 */
const REGISTRATION_OPEN = true;

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

  let screen;
  if (loggedIn) {
    screen = (
      <Home
        initialChatId={initialChatId}
        onLogout={async () => {
          await logout();
          handleLoggedOut();
        }}
      />
    );
  } else if (REGISTRATION_OPEN && page === "register") {
    screen = (
      <Register
        onRegister={() => setPage("login")}
        onBack={() => setPage("login")}
      />
    );
  } else {
    screen = (
      <Login
        onLogin={() => setLoggedIn(true)}
        onRegister={REGISTRATION_OPEN ? () => setPage("register") : null}
      />
    );
  }

  // The banner sits beside the screen rather than inside one, so it shows on
  // the login page too — a stale login page is the worst place to be stuck.
  return (
    <>
      <UpdateBanner />
      {screen}
      {/* One call UI for the whole signed-in app, so a call keeps going
          while you move between chats. */}
      {loggedIn && <CallOverlay />}
    </>
  );
}
