"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

interface AuthContextContent {
  /** Whether the current session is logged in (resolves to the admin Role). */
  authenticated: boolean;
  /** Whether the server has auth configured (AUTH_PASSWORD set). */
  authConfigured: boolean;
  /** True until the initial /api/me check resolves. */
  loading: boolean;
  /** Log in with the shared password. Throws with a message on failure. */
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextContent>({
  authenticated: false,
  authConfigured: false,
  loading: true,
  login: async () => {},
  logout: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [authenticated, setAuthenticated] = useState(false);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setAuthenticated(!!data.authenticated);
        setAuthConfigured(!!data.authConfigured);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (password: string) => {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Login failed");
    }
    // Reload so the signaling WebSocket re-handshakes carrying the new auth
    // cookie — the SFU only re-evaluates the role on a fresh connection.
    window.location.reload();
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/logout", { method: "POST" }).catch(() => {});
    window.location.reload();
  }, []);

  return (
    <AuthContext.Provider
      value={{ authenticated, authConfigured, loading, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  return useContext(AuthContext);
}
