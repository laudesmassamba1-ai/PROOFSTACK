import {
  BadgeCheck,
  Bell,
  Boxes,
  Brain,
  ChevronDown,
  CloudOff,
  Command,
  CreditCard,
  FolderKanban,
  Globe2,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageOpen,
  RotateCw,
  Route as RouteIcon,
  Search,
  Settings as SettingsIcon,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  X,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router";

import { DesktopTools } from "../components/app/DesktopTools.js";
import { InvitationBanner } from "../components/app/InvitationBanner.js";
import { WindowControls } from "../components/app/WindowControls.js";
import { Mark } from "../components/brand/Logo.js";
import { useI18n } from "../i18n/index.js";
import { API_BASE, apiFetch } from "../lib/api.js";
import { initReveals, teardownReveals } from "../lib/reveal.js";
import { useSession } from "../lib/session.js";

interface ShellProject {
  id: string;
  name: string;
}

interface CommandEntry {
  label: string;
  group: "routes" | "projects";
  to: string;
  icon: ReactNode;
}

/**
 * Authenticated shell.
 *
 * The workspace is a paper instrument inside a bordered frame, with navigation on
 * top instead of a permanent dark rail. Three honest session states remain: loading,
 * signed out (redirect preserving the destination), and API unreachable with retry.
 */
export function AppLayout() {
  const session = useSession();
  const { locale, t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ShellProject[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [enginesOpen, setEnginesOpen] = useState(false);
  const paletteRef = useRef<HTMLDialogElement>(null);
  const paletteInputRef = useRef<HTMLInputElement>(null);
  const mobileRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Read through a local so `noUncheckedIndexedAccess` is satisfied honestly: an empty
    // list has nothing to select, and we do nothing rather than assert a value exists.
    const first = session.workspaces[0];
    if (session.status === "ready" && !session.workspaceId && first) {
      session.setWorkspaceId(first.id);
    }
  }, [session.status, session.workspaceId, session.workspaces, session.setWorkspaceId]);

  useEffect(() => {
    if (!session.workspaceId) {
      setProjects([]);
      return;
    }
    let alive = true;
    void apiFetch<{ items: ShellProject[] }>(`/api/v1/projects?workspaceId=${session.workspaceId}`)
      .then((body) => {
        if (alive) setProjects(body.items);
      })
      .catch(() => {
        if (alive) setProjects([]);
      });
    return () => {
      alive = false;
    };
  }, [session.workspaceId]);

  // Close transient overlays on navigation. pathname is the trigger by design.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname IS the dependency
  useEffect(() => {
    setMobileOpen(false);
    setAccountOpen(false);
    setEnginesOpen(false);
    setPaletteOpen(false);
  }, [location.pathname]);

  // Scroll-choreographed reveals, re-armed per route.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname IS the dependency
  useEffect(() => {
    const timer = window.setTimeout(initReveals, 60);
    return () => {
      window.clearTimeout(timer);
      teardownReveals();
    };
  }, [location.pathname]);

  useEffect(() => {
    const bridge = window.proofcoreDesktop;
    if (!bridge) return;
    return bridge.onNavigate((path) => {
      if (path.startsWith("/app/")) navigate(path);
    });
  }, [navigate]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The title bar is a native drag region: double-clicking it toggles maximize. Listening
  // at document level keeps the header a static element for accessibility linters and
  // covers both the normal shell and the offline shell.
  useEffect(() => {
    const onDoubleClick = (event: globalThis.MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".app-topbar")) return;
      if (target.closest("button, a, select, input, label")) return;
      void window.proofcoreDesktop?.window("maximize");
    };
    document.addEventListener("dblclick", onDoubleClick);
    return () => document.removeEventListener("dblclick", onDoubleClick);
  }, []);

  useEffect(() => {
    const dialog = paletteRef.current;
    if (!dialog) return;
    if (paletteOpen && !dialog.open) {
      dialog.showModal();
      setQuery("");
      setSelected(0);
      requestAnimationFrame(() => paletteInputRef.current?.focus());
    } else if (!paletteOpen && dialog.open) {
      dialog.close();
    }
  }, [paletteOpen]);

  // A read action in the inbox changes the count; refresh without a page reload.
  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ unreadCount?: number }>).detail;
      if (typeof detail?.unreadCount === "number") {
        setUnreadCount(detail.unreadCount);
      }
    };
    window.addEventListener("proofcore:notifications-changed", onChange);
    return () => window.removeEventListener("proofcore:notifications-changed", onChange);
  }, []);

  // The badge and the inbox page read the same endpoint, so they cannot disagree.
  useEffect(() => {
    if (!session.workspaceId) {
      setUnreadCount(0);
      return;
    }
    let active = true;
    apiFetch<{ unreadCount: number }>(
      `/api/v1/notifications?workspaceId=${encodeURIComponent(session.workspaceId)}&limit=1`
    )
      .then((body) => {
        if (active) setUnreadCount(body.unreadCount);
      })
      .catch(() => {
        // An unreachable API is not "zero notifications"; keep the last known value.
      });
    return () => {
      active = false;
    };
  }, [session.workspaceId]);

  useEffect(() => {
    if (!accountOpen) return;
    const onDown = (event: PointerEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [accountOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = mobileRef.current;
    document.body.style.overflow = "hidden";
    const focusables = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
    focusables()[0]?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      // list.length > 0 is checked above; use at() so no assertion is needed.
      const first = list[0];
      const last = list.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, [mobileOpen]);

  // Simple is the default: a first-time user gets three doors, not the whole expert shell.
  // The choice is remembered per browser; the account, projects and results are untouched,
  // so switching never moves or hides any data.
  const [uiMode, setUiMode] = useState<"simple" | "studio">(() => {
    try {
      return window.localStorage.getItem("proofcore.ui-mode.v1") === "studio" ? "studio" : "simple";
    } catch {
      return "simple";
    }
  });
  const toggleMode = useCallback(() => {
    setUiMode((current) => {
      const next = current === "simple" ? "studio" : "simple";
      try {
        window.localStorage.setItem("proofcore.ui-mode.v1", next);
      } catch {
        /* private mode: the choice applies for this visit */
      }
      return next;
    });
  }, []);

  const routes = useMemo<CommandEntry[]>(() => {
    const list: Array<[string, string, ReactNode]> = [
      [t("ws.nav.overview"), "/app", <LayoutDashboard key="overview" size={15} />],
      [t("ws.nav.projects"), "/app/projects", <FolderKanban key="projects" size={15} />],
      [locale === "fr" ? "Démarrer" : "Start", "/app/start", <Search key="start" size={15} />],
      [t("ws.nav.workspace"), "/app/workspace", <Boxes key="workspace" size={15} />],
      ["WORLD", "/app/modules/world", <Globe2 key="world" size={15} />],
      ["FLOW", "/app/modules/flow", <RouteIcon key="flow" size={15} />],
      ["EXIT", "/app/modules/exit", <PackageOpen key="exit" size={15} />],
      ["FAIL", "/app/modules/fail", <ShieldAlert key="fail" size={15} />],
      ["CLEAN", "/app/modules/clean", <BadgeCheck key="clean" size={15} />],
      [t("ws.nav.cli"), "/app/cli", <Terminal key="cli" size={15} />],
      [t("ws.nav.ai"), "/app/ai", <Brain key="ai" size={15} />],
      [t("ws.nav.billing"), "/app/billing", <CreditCard key="billing" size={15} />],
      [t("ws.nav.settings"), "/app/settings", <SettingsIcon key="settings" size={15} />],
    ];
    if (window.proofcoreDesktop) {
      list.splice(9, 0, ["Terminal", "/app/terminal", <Terminal key="terminal" size={15} />]);
    }
    if (session.isAdmin) {
      list.push([t("ws.nav.operations"), "/app/admin", <ShieldCheck key="admin" size={15} />]);
    }
    const visible =
      uiMode === "simple"
        ? list.filter(([, to]) => to === "/app" || to === "/app/projects" || to === "/app/start")
        : list;
    return visible.map(([label, to, icon]) => ({ label, to, icon, group: "routes" as const }));
  }, [session.isAdmin, t, uiMode, locale]);

  const commands = useMemo<CommandEntry[]>(
    () => [
      ...routes,
      ...projects.map((project) => ({
        label: project.name,
        group: "projects" as const,
        to: `/app/projects/${project.id}`,
        icon: <FolderKanban key={project.id} size={15} />,
      })),
    ],
    [projects, routes]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter(
      (entry) =>
        entry.label.toLowerCase().includes(needle) || entry.to.toLowerCase().includes(needle)
    );
  }, [commands, query]);

  const activate = useCallback(
    (entry: CommandEntry) => {
      setPaletteOpen(false);
      navigate(entry.to);
    },
    [navigate]
  );

  if (session.status === "loading") {
    return (
      <div className="app-shell app-centered-shell">
        <WindowControls floating />
        <div className="app-frame app-loading-frame">
          <div className="app-loader" role="status" aria-live="polite" aria-label={t("ws.loading")}>
            <span className="sr-only">{t("ws.loading")}</span>
          </div>
          <p className="app-eyebrow">{t("ws.loading")}</p>
        </div>
      </div>
    );
  }

  if (session.status === "signed_out") {
    return <Navigate to={`/signin?next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  // The local agent does not need the site: when the session cannot be resolved,
  // this route still runs against the engine on loopback instead of hiding behind
  // the offline screen. It is reachable from that screen's local console action.
  if (
    session.status === "unreachable" &&
    location.pathname.startsWith("/app/ai/local") &&
    window.proofcoreDesktop
  ) {
    return (
      <div className="app-shell">
        <div className="app-frame">
          <header className="app-topbar">
            <NavLink to="/app" className="app-brand-lockup" aria-label="PROOFCORE workspace">
              <Mark size={34} variant="onLight" />
              <span className="wordmark app-brand-word">PROOFCORE</span>
              <span className="app-beta">{t("ws.shell.beta")}</span>
            </NavLink>
            <div className="app-top-actions">
              <span className="app-offline-chip">
                <CloudOff size={13} /> {t("ws.offline.banner")}
              </span>
              <button
                type="button"
                className="app-btn app-btn-sm"
                onClick={() => void session.refresh()}
              >
                <RotateCw size={13} /> {t("ws.offline.retry")}
              </button>
              <WindowControls />
            </div>
          </header>
          <main id="main" className="app-main">
            <Outlet />
          </main>
        </div>
      </div>
    );
  }

  if (session.status === "unreachable") {
    return (
      <div className="app-shell app-centered-shell">
        <WindowControls floating />
        <div className="app-frame app-service-frame">
          <div className="app-service-mark" aria-hidden>
            <CloudOff size={34} strokeWidth={1.35} />
          </div>
          <p className="app-eyebrow">PROOFCORE / OFFLINE</p>
          <h1 className="app-display app-service-title">{t("ws.service.title")}</h1>
          <p className="app-support">{t("ws.service.body")}</p>
          <div className="app-service-actions">
            <button
              type="button"
              className="app-btn app-btn-primary"
              onClick={() => void session.refresh()}
            >
              <RotateCw size={14} /> {t("ws.service.retry")}
            </button>
            {window.proofcoreDesktop ? (
              <button
                type="button"
                className="app-btn"
                onClick={() => void window.proofcoreDesktop?.action("open-agent")}
              >
                {t("ws.service.openLocal")}
              </button>
            ) : null}
          </div>
          <p className="app-service-note">{t("ws.service.note")}</p>
          {import.meta.env.DEV ? (
            <details className="app-service-details">
              <summary>{t("ws.service.diagnostic")}</summary>
              <code className="app-mono">{API_BASE}</code>
            </details>
          ) : null}
        </div>
      </div>
    );
  }

  const workspace = session.workspaces.find((item) => item.id === session.workspaceId);
  const projectMatch = location.pathname.match(/^\/app\/projects\/([^/]+)/);
  const currentProjectId = projectMatch?.[1] ?? "";
  const initials = (session.user?.name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  const enginesActive = location.pathname.startsWith("/app/modules");

  return (
    <div className="app-shell">
      <div className="app-frame">
        <header className="app-topbar">
          <NavLink to="/app" className="app-brand-lockup" aria-label="PROOFCORE workspace">
            <Mark size={34} variant="onLight" />
            <span className="wordmark app-brand-word">PROOFCORE</span>
            <span className="app-beta">{t("ws.shell.beta")}</span>
          </NavLink>

          <nav className="app-desktop-nav" aria-label={t("ws.nav.menu")}>
            <NavLink to="/app" end className="app-toplink">
              {t("ws.nav.overview")}
            </NavLink>
            <NavLink to="/app/projects" className="app-toplink">
              {t("ws.nav.projects")}
            </NavLink>
            <NavLink to="/app/start" className="app-toplink">
              {locale === "fr" ? "Démarrer" : "Start"}
            </NavLink>
            {/* Simple mode hides the expert surfaces from the menu; every route stays
                reachable, and Studio restores the full navigation without a page reload. */}
            {uiMode === "studio" ? (
              <>
                <NavLink
                  to="/app/workspace"
                  className={({ isActive }) => `app-toplink ${isActive ? "is-active" : ""}`}
                >
                  {t("ws.nav.workspace")}
                </NavLink>
                <div className="app-engines">
                  <button
                    type="button"
                    className={`app-toplink app-engines-trigger ${enginesActive ? "is-active" : ""}`}
                    aria-expanded={enginesOpen}
                    aria-haspopup="true"
                    onClick={() => setEnginesOpen((value) => !value)}
                  >
                    {t("ws.nav.engines")} <ChevronDown size={13} />
                  </button>
                  {enginesOpen ? (
                    <div className="app-nav-popover" role="menu">
                      {[
                        ["WORLD", "/app/modules/world", <Globe2 key="world" size={14} />],
                        ["FLOW", "/app/modules/flow", <RouteIcon key="flow" size={14} />],
                        ["EXIT", "/app/modules/exit", <PackageOpen key="exit" size={14} />],
                        ["FAIL", "/app/modules/fail", <ShieldAlert key="fail" size={14} />],
                        ["CLEAN", "/app/modules/clean", <BadgeCheck key="clean" size={14} />],
                      ].map(([label, to, icon]) => (
                        <NavLink
                          key={String(label)}
                          to={String(to)}
                          className="app-nav-popover-link"
                          role="menuitem"
                        >
                          {icon} {label}
                        </NavLink>
                      ))}
                      <NavLink
                        to="/app/modules"
                        end
                        className="app-nav-popover-link"
                        role="menuitem"
                      >
                        {locale === "fr" ? "Vue d’ensemble" : "Overview"}
                      </NavLink>
                      <NavLink to="/app/scan" className="app-nav-popover-link" role="menuitem">
                        {locale === "fr" ? "Scanner une adresse" : "Scan an address"}
                      </NavLink>
                    </div>
                  ) : null}
                </div>
                <NavLink to="/app/cli" className="app-toplink">
                  {t("ws.nav.cli")}
                </NavLink>
                <NavLink to="/app/ai" className="app-toplink">
                  {t("ws.nav.ai")}
                </NavLink>
              </>
            ) : null}
          </nav>

          <div className="app-top-actions">
            <label className="sr-only" htmlFor="workspace-switcher">
              {t("ws.shell.workspace")}
            </label>
            <div className="app-shell-select-wrap">
              <select
                id="workspace-switcher"
                className="app-shell-pill app-shell-select"
                value={session.workspaceId ?? ""}
                onChange={(event) => session.setWorkspaceId(event.target.value)}
              >
                {session.workspaces.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} aria-hidden />
            </div>

            {projects.length > 0 ? (
              <>
                <label className="sr-only" htmlFor="project-switcher">
                  {t("ws.shell.project")}
                </label>
                <div className="app-shell-select-wrap app-project-pill">
                  <select
                    id="project-switcher"
                    className="app-shell-pill app-shell-select"
                    value={currentProjectId}
                    onChange={(event) => {
                      const id = event.target.value;
                      navigate(id ? `/app/projects/${id}` : "/app/projects");
                    }}
                  >
                    <option value="">{t("ws.shell.allProjects")}</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={13} aria-hidden />
                </div>
              </>
            ) : null}

            <NavLink
              to="/app/notifications"
              className="app-shell-pill app-notification-bell"
              aria-label={locale === "fr" ? "Notifications" : "Notifications"}
            >
              <Bell size={14} />
              {unreadCount > 0 ? (
                <span className="app-notification-badge" aria-hidden="true">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              ) : null}
            </NavLink>

            <button
              type="button"
              className="app-command-trigger"
              onClick={() => setPaletteOpen(true)}
              aria-label={t("ws.shell.command")}
            >
              <Search size={14} />
              <span>{t("ws.shell.command")}</span>
              <kbd>⌘K</kbd>
            </button>

            <button
              type="button"
              className="app-shell-pill app-mode-toggle"
              onClick={toggleMode}
              aria-pressed={uiMode === "studio"}
              title={
                uiMode === "simple"
                  ? locale === "fr"
                    ? "Afficher les outils avancés (modules, CLI, IA)"
                    : "Show advanced tools (modules, CLI, AI)"
                  : locale === "fr"
                    ? "Revenir à l'interface simplifiée"
                    : "Return to the simplified interface"
              }
            >
              {uiMode === "simple"
                ? locale === "fr"
                  ? "Mode Studio"
                  : "Studio mode"
                : locale === "fr"
                  ? "Mode simple"
                  : "Simple mode"}
            </button>

            <DesktopTools />

            <div className="app-account-wrap" ref={accountRef}>
              <button
                type="button"
                className="app-account"
                aria-label={t("ws.shell.account")}
                aria-expanded={accountOpen}
                onClick={() => setAccountOpen((value) => !value)}
              >
                {initials || "PS"}
              </button>
              {accountOpen ? (
                <div className="app-account-menu">
                  <div className="app-account-menu-head">
                    <span className="app-account app-account-large">{initials || "PS"}</span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{session.user?.name}</p>
                      <p className="truncate text-xs text-muted">{session.user?.email}</p>
                    </div>
                  </div>
                  <p className="app-account-meta">
                    {workspace
                      ? `${workspace.name} · ${
                          locale === "fr"
                            ? ((
                                {
                                  owner: "propriétaire",
                                  admin: "administrateur",
                                  member: "membre",
                                } as Record<string, string>
                              )[workspace.role] ?? workspace.role)
                            : workspace.role
                        }`
                      : locale === "fr"
                        ? "Aucun espace"
                        : "No workspace"}
                  </p>
                  <NavLink to="/app/settings" className="app-account-link">
                    <SettingsIcon size={14} /> {t("ws.nav.settings")}
                  </NavLink>
                  <NavLink to="/app/billing" className="app-account-link">
                    <CreditCard size={14} /> {t("ws.nav.billing")}
                  </NavLink>
                  <button
                    type="button"
                    className="app-account-link app-account-signout"
                    onClick={() => void session.signOut()}
                  >
                    <LogOut size={14} /> {t("ws.shell.signOut")}
                  </button>
                </div>
              ) : null}
            </div>

            <button
              type="button"
              className="app-menu-trigger"
              aria-label={t("ws.nav.menu")}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
            >
              <Menu size={19} />
            </button>
            <WindowControls />
          </div>
        </header>

        {session.offline ? (
          <div className="app-offline-banner" role="status" aria-live="polite">
            <CloudOff size={15} aria-hidden />
            <span>
              <strong>{t("ws.offline.banner")}</strong> {t("ws.offline.bannerBody")}
            </span>
            <button type="button" onClick={() => void session.refresh()}>
              <RotateCw size={13} /> {t("ws.offline.retry")}
            </button>
          </div>
        ) : null}

        <InvitationBanner />

        <main id="main" className="app-main" key={location.pathname}>
          <Outlet />
        </main>

        <footer className="app-footer">
          <span>PROOFCORE / {workspace?.name ?? "workspace"}</span>
          <span>WORLD · FLOW · EXIT · FAIL · CLEAN</span>
        </footer>
      </div>

      {mobileOpen ? (
        <div
          className="app-mobile-sheet"
          role="dialog"
          aria-modal="true"
          aria-label={t("ws.nav.menu")}
          ref={mobileRef}
        >
          <div className="app-mobile-head">
            <div className="app-brand-lockup">
              <Mark size={38} variant="onLight" />
              <span className="wordmark app-brand-word">PROOFCORE</span>
            </div>
            <button
              type="button"
              className="app-mobile-close"
              onClick={() => setMobileOpen(false)}
              aria-label={t("ws.nav.close")}
            >
              <X size={22} />
            </button>
          </div>
          <nav className="app-mobile-nav" aria-label={t("ws.nav.menu")}>
            {routes.map((entry, index) => (
              <NavLink key={entry.to} to={entry.to} className="app-mobile-link">
                <span className="app-mobile-index">{String(index + 1).padStart(2, "0")}</span>
                {entry.label}
              </NavLink>
            ))}
          </nav>
          <div className="app-mobile-foot">
            <button type="button" className="app-btn app-btn-sm" onClick={toggleMode}>
              {uiMode === "simple"
                ? locale === "fr"
                  ? "Afficher le mode Studio"
                  : "Show Studio mode"
                : locale === "fr"
                  ? "Revenir au mode simple"
                  : "Return to simple mode"}
            </button>
            <div className="app-mobile-select-wrap">
              <label className="app-eyebrow" htmlFor="mobile-workspace">
                {t("ws.shell.workspace")}
              </label>
              <select
                id="mobile-workspace"
                className="app-shell-pill app-shell-select"
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
            <button type="button" className="app-btn" onClick={() => void session.signOut()}>
              <LogOut size={14} /> {t("ws.shell.signOut")}
            </button>
          </div>
        </div>
      ) : null}

      <dialog
        ref={paletteRef}
        className="app-command-dialog"
        onClose={() => setPaletteOpen(false)}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPaletteOpen(false);
        }}
      >
        <div className="app-command">
          <div className="app-command-search">
            <Search size={17} aria-hidden />
            <input
              ref={paletteInputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelected(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setSelected((value) => Math.min(filtered.length - 1, value + 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setSelected((value) => Math.max(0, value - 1));
                } else if (event.key === "Enter" && filtered[selected]) {
                  event.preventDefault();
                  const command = filtered[selected];
                  if (command) activate(command);
                }
              }}
              placeholder={t("ws.search.placeholder")}
              aria-label={t("ws.search.placeholder")}
            />
            <Command size={15} aria-hidden />
          </div>
          <div className="app-command-results">
            {filtered.length === 0 ? (
              <p className="app-command-empty">{t("ws.search.empty")}</p>
            ) : (
              (["routes", "projects"] as const).map((group) => {
                const entries = filtered.filter((entry) => entry.group === group);
                if (entries.length === 0) return null;
                return (
                  <section key={group} className="app-command-group">
                    <p className="app-eyebrow">
                      {group === "routes" ? t("ws.search.routes") : t("ws.search.projects")}
                    </p>
                    {entries.map((entry) => {
                      const index = filtered.indexOf(entry);
                      return (
                        <button
                          key={`${group}-${entry.to}`}
                          type="button"
                          className={`app-command-item ${index === selected ? "is-selected" : ""}`}
                          onMouseEnter={() => setSelected(index)}
                          onClick={() => activate(entry)}
                        >
                          <span className="app-command-icon">{entry.icon}</span>
                          <span>{entry.label}</span>
                          <span className="app-command-path">{entry.to}</span>
                        </button>
                      );
                    })}
                  </section>
                );
              })
            )}
          </div>
          <p className="app-command-hint">{t("ws.search.hint")}</p>
        </div>
      </dialog>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  const { locale } = useI18n();
  const sectionLabel =
    eyebrow ?? (locale === "fr" ? "PROOFCORE / espace de travail" : "PROOFCORE / workspace");
  return (
    <header className="app-page-head">
      <p className="app-eyebrow">{sectionLabel}</p>
      <div className="app-page-head-row">
        <h1 className="app-page-title">{title}</h1>
        {actions ? <div className="app-page-actions">{actions}</div> : null}
      </div>
      {description ? <p className="app-page-description">{description}</p> : null}
    </header>
  );
}
