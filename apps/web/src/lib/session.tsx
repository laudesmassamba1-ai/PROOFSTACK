import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch, postJson } from "./api.js";

/**
 * Session state for the dashboard.
 *
 * The cookie is HttpOnly, so the browser cannot inspect it and does not need to: this
 * provider asks the API who the caller is. `status: "signed_out"` and
 * `status: "unreachable"` are deliberately distinct — a backend outage is not an
 * authentication failure, and the UI must not pretend the user was signed out.
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  emailVerified: boolean;
}

export interface SessionWorkspace {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  role: "owner" | "admin" | "member" | "viewer";
}

interface SessionPayload {
  user: SessionUser | null;
  workspaces?: SessionWorkspace[];
  emailVerification?: "not_configured";
  isAdmin?: boolean;
}

interface SessionState {
  status: "loading" | "ready" | "signed_out" | "unreachable";
  user: SessionUser | null;
  workspaces: SessionWorkspace[];
  workspaceId: string | null;
  setWorkspaceId: (id: string) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  emailVerification: "not_configured" | null;
  /** Navigation hint only: the admin API re-checks the allowlist server-side. */
  isAdmin: boolean;
}

const SessionContext = createContext<SessionState | null>(null);
const WORKSPACE_KEY = "proofcore.workspace";

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SessionState["status"]>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [workspaces, setWorkspaces] = useState<SessionWorkspace[]>([]);
  const [workspaceId, setWorkspaceIdState] = useState<string | null>(null);
  const [emailVerification, setEmailVerification] = useState<"not_configured" | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const apply = useCallback((payload: SessionPayload) => {
    setUser(payload.user);
    const list = payload.workspaces ?? [];
    setWorkspaces(list);
    setEmailVerification(payload.emailVerification ?? null);
    setIsAdmin(payload.user ? payload.isAdmin === true : false);
    if (!payload.user) {
      setStatus("signed_out");
      setWorkspaceIdState(null);
      return;
    }
    const stored =
      typeof window !== "undefined" ? window.localStorage.getItem(WORKSPACE_KEY) : null;
    const next = list.find((workspace) => workspace.id === stored)?.id ?? list[0]?.id ?? null;
    setWorkspaceIdState(next);
    setStatus("ready");
  }, []);

  const refresh = useCallback(async () => {
    try {
      const payload = await apiFetch<SessionPayload>("/api/auth/session");
      apply(payload);
    } catch {
      setStatus((current) => (current === "ready" ? current : "unreachable"));
    }
  }, [apply]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setWorkspaceId = useCallback((id: string) => {
    setWorkspaceIdState(id);
    if (typeof window !== "undefined") window.localStorage.setItem(WORKSPACE_KEY, id);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await postJson("/api/auth/sign-out", {});
      // In the native window the local shell owns a vault copy; the web cookie alone is
      // not enough to sign this machine out. The bridge clears it, and ignores errors so
      // signing out still works in a plain browser.
      await window.proofcoreDesktop?.logout().catch(() => undefined);
    } finally {
      setUser(null);
      setWorkspaces([]);
      setWorkspaceIdState(null);
      setIsAdmin(false);
      setStatus("signed_out");
    }
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      status,
      user,
      workspaces,
      workspaceId,
      setWorkspaceId,
      refresh,
      signOut,
      emailVerification,
      isAdmin,
    }),
    [
      status,
      user,
      workspaces,
      workspaceId,
      setWorkspaceId,
      refresh,
      signOut,
      emailVerification,
      isAdmin,
    ]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
