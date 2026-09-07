import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import * as authApi from "../api/auth";
import { onSessionExpired } from "../api/client";
import { getItem } from "../storage";
import { chatSocket } from "../services/websocket";
import { registerForPush, unregisterForPush } from "../services/notifications";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getItem("username"));
  const [isAdmin, setIsAdmin] = useState(() => getItem("is_admin") === "1");
  const [signedIn, setSignedIn] = useState(() => Boolean(getItem("token")));

  const handleSignedOut = useCallback(() => {
    chatSocket.stop();
    setSignedIn(false);
    setUser(null);
    setIsAdmin(false);
  }, []);

  const refreshRole = useCallback(async () => {
    try {
      const me = await authApi.getMe();
      setIsAdmin(Boolean(me.is_admin));
      return me;
    } catch {
      return null;
    }
  }, []);

  // One place reacts to a revoked/expired session (client.js emits it on 401).
  useEffect(() => onSessionExpired(handleSignedOut), [handleSignedOut]);

  // Keep the socket alive for the whole authenticated session; also register
  // for push and re-confirm the admin role (which only gates whether the Admin
  // tab shows — the API is enforced server-side regardless).
  useEffect(() => {
    if (signedIn) {
      chatSocket.start();
      registerForPush().catch(() => {});
      refreshRole();
      return () => chatSocket.stop();
    }
    return undefined;
  }, [signedIn, refreshRole]);

  const signIn = useCallback(async (username, password) => {
    const data = await authApi.login(username, password);
    setUser(data.username || username);
    setIsAdmin(Boolean(data.is_admin));
    setSignedIn(true);
    return data;
  }, []);

  const signOut = useCallback(async () => {
    await unregisterForPush();
    await authApi.logout();
    handleSignedOut();
  }, [handleSignedOut]);

  const value = useMemo(
    () => ({ user, isAdmin, signedIn, signIn, signOut, refreshRole }),
    [user, isAdmin, signedIn, signIn, signOut, refreshRole]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
