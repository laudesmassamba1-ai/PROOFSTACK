import {
  BarChart3,
  CreditCard,
  FolderKanban,
  Globe2,
  LoaderCircle,
  LogOut,
  PackageOpen,
  Route as RouteIcon,
  Settings,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { useEffect } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router";
import { Wordmark } from "../components/brand/Logo.js";
import { API_BASE } from "../lib/api.js";
import { useSession } from "../lib/session.js";

/**
 * Authenticated shell.
 *
 * Three honest states: loading, signed out (redirect, preserving where the user was
 * going), and API unreachable (a clear message plus retry — not a fake login screen,
 * and not a silent redirect that looks like a bad password).
 */
export function AppLayout() {
  const session = useSession();
  const location = useLocation();
  // Auto-select a workspace if none is selected but workspaces exist (login flow).
  // The first element is read through a local so `noUncheckedIndexedAccess` is satisfied
  // honestly: if the list is empty there is nothing to select, and we do nothing.
  useEffect(() => {
    const first = session.workspaces[0];
    if (session.status === "ready" && !session.workspaceId && first) {
      session.setWorkspaceId(first.id);
    }
  }, [session.status, session.workspaceId, session.workspaces, session.setWorkspaceId]);

  if (session.status === "loading") {
    return (
      <div className="app-shell grid min-h-screen place-items-center">
        <span className="flex items-center gap-2 text-sm text-muted">
          <LoaderCircle size={16} className="animate-spin" /> Loading your workspace…
        </span>
      </div>
    );
  }

  if (session.status === "signed_out") {
    return <Navigate to={`/signin?next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  if (session.status === "unreachable") {
    return (
      <div className="app-shell grid min-h-screen place-items-center px-6">
        <div className="app-card max-w-[460px] p-6">
          <h1 className="text-lg font-semibold">The API is not reachable</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The dashboard needs the PROOFSTACK API at <code className="app-mono">{API_BASE}</code>.
            Start it with <code className="app-mono">pnpm api:dev</code>, then retry. Nothing was
            lost.
          </p>
          <button
            type="button"
            className="app-btn app-btn-primary mt-4"
            onClick={() => void session.refresh()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const workspace = session.workspaces.find((item) => item.id === session.workspaceId);

  return (
    <div className="app-shell">
      <div className="mx-auto flex max-w-[1440px] flex-col lg:flex-row">
        <aside className="app-sidebar border-b border-white/8 lg:min-h-screen lg:w-[264px] lg:shrink-0 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between px-4 py-4 lg:px-5">
            <NavLink to="/" aria-label="PROOFSTACK home">
              <Wordmark size={12} />
            </NavLink>
            <span className="rounded-full border border-brand-mint/20 bg-brand-mint/10 px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-brand-mint">
              beta
            </span>
          </div>

          <div className="px-4 pb-4 lg:px-5">
            <label className="app-label text-white/40" htmlFor="workspace-switcher">
              Workspace
            </label>
            <select
              id="workspace-switcher"
              className="app-sidebar-select"
              value={session.workspaceId ?? ""}
              onChange={(event) => session.setWorkspaceId(event.target.value)}
            >
              {session.workspaces.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>

          <nav
            className="flex flex-wrap gap-1 px-3 pb-3 lg:flex-col lg:flex-nowrap lg:px-3 lg:pb-4"
            aria-label="Dashboard"
          >
            <NavLink to="/app" end className="app-sidebar-link whitespace-nowrap">
              <BarChart3 size={16} /> Overview
            </NavLink>
            <NavLink to="/app/projects" className="app-sidebar-link whitespace-nowrap">
              <FolderKanban size={16} /> Projects
            </NavLink>
            <NavLink to="/app/modules/world" className="app-sidebar-link whitespace-nowrap">
              <Globe2 size={16} /> WORLD
            </NavLink>
            <NavLink to="/app/modules/flow" className="app-sidebar-link whitespace-nowrap">
              <RouteIcon size={16} /> FLOW
            </NavLink>
            <NavLink to="/app/modules/exit" className="app-sidebar-link whitespace-nowrap">
              <PackageOpen size={16} /> EXIT
            </NavLink>
            <NavLink to="/app/cli" className="app-sidebar-link whitespace-nowrap">
              <Terminal size={16} /> CLI setup
            </NavLink>
            <NavLink to="/app/billing" className="app-sidebar-link whitespace-nowrap">
              <CreditCard size={16} /> Billing
            </NavLink>
            <NavLink to="/app/settings" className="app-sidebar-link whitespace-nowrap">
              <Settings size={16} /> Settings
            </NavLink>
            {session.isAdmin ? (
              <NavLink to="/app/admin" className="app-sidebar-link whitespace-nowrap">
                <ShieldCheck size={16} /> Operations
              </NavLink>
            ) : null}
          </nav>

          {/* Mobile has no persistent footer: keep the account reachable instead of hiding it. */}
          <div className="flex items-center justify-between gap-3 border-t border-white/8 px-4 py-3 lg:hidden">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white/85">{session.user?.name}</p>
              <p className="truncate text-xs text-white/40">{session.user?.email}</p>
            </div>
            <button
              type="button"
              className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/75"
              onClick={() => void session.signOut()}
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>

          <div className="app-sidebar-user mt-auto hidden px-5 py-5 lg:block">
            <p className="truncate text-sm font-medium text-white/85">{session.user?.name}</p>
            <p className="truncate text-xs text-white/40">{session.user?.email}</p>
            <p className="mt-1 text-xs text-white/30">
              {workspace ? `${workspace.name} · ${workspace.role}` : "No workspace"}
            </p>
            <button
              type="button"
              className="mt-3 w-full rounded-lg border border-white/12 px-3 py-2 text-xs text-white/65 transition-colors hover:border-white/25 hover:text-white"
              onClick={() => void session.signOut()}
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 bg-background px-3 py-5 sm:px-6 sm:py-6 lg:px-10 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[1.45rem] font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-[70ch] text-sm leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
