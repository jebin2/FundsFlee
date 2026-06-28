// Replacement for next-auth/react, backed by the backend's GET /api/auth/session
// (which itself wraps google-auth-service). Exposes the same surface the ported
// client code expects: SessionProvider, useSession, signIn, signOut.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export interface Session {
  user?: { name?: string | null; email?: string | null; image?: string | null };
  sheet_id?: string;
  sheet_is_new?: boolean;
  error?: string;
}

export type SessionStatus = "loading" | "authenticated" | "unauthenticated";

interface SessionContextValue {
  data: Session | null;
  status: SessionStatus;
  update: () => Promise<Session | null>;
}

const SessionContext = createContext<SessionContextValue>({
  data: null,
  status: "loading",
  update: async () => null,
});

async function fetchSession(): Promise<Session | null> {
  try {
    const res = await fetch("/api/auth/session", { credentials: "include" });
    if (!res.ok) return null;
    return (await res.json()) as Session;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Session | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");

  const update = useCallback(async () => {
    const session = await fetchSession();
    setData(session);
    setStatus(session ? "authenticated" : "unauthenticated");
    return session;
  }, []);

  useEffect(() => {
    void update();
  }, [update]);

  return (
    <SessionContext.Provider value={{ data, status, update }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}

// Begin Google OAuth — backend /auth/login 307s to the consent screen and
// redirects back via the callback (which sets the session cookie).
export function signIn(_provider?: string, _opts?: { callbackUrl?: string }) {
  void _provider;
  window.location.href = "/auth/login";
}

// Revoke the session server-side, then land on the callback (defaults to "/").
export async function signOut(opts?: { callbackUrl?: string }) {
  try {
    await fetch("/auth/logout", { method: "POST", credentials: "include" });
  } catch {
    // ignore — still redirect
  }
  window.location.href = opts?.callbackUrl ?? "/";
}
