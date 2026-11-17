import {
  Box,
  ChevronDown,
  Command,
  CreditCard,
  FolderKanban,
  Globe2,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageOpen,
  Route as RouteIcon,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Terminal,
  X,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router";

import { Mark } from "../components/brand/Logo.js";
import { useI18n } from "../i18n/index.js";
import { API_BASE, apiFetch } from "../lib/api.js";
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

  // Non-destructive 3D toggle (UI test)
  const [threeDEnabled, setThreeDEnabled] = useState<boolean>((): boolean => {
    try {
      const v = window.localStorage?.getItem("proofstack_3d_enabled");
      return v === "true";
    } catch {
      // ignore
    }
    return false;
  });

  const toggleThreeD = () => {
    const next = !threeDEnabled;
    setThreeDEnabled(next);
    try {
      window.localStorage?.setItem("proofstack_3d_enabled", next ? "true" : "false");
    } catch {}
    if (typeof document !== "undefined") {
      document.body.dataset.enhanced3d = next ? "true" : "";
    }
  };

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

  useEffect(() => {
    setMobileOpen(false);
    setAccountOpen(false);
    setEnginesOpen(false);
    setPaletteOpen(false);
  }, [location.pathname]);

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
      const first = list[0]!;
      const last = list[list.length - 1]!;
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

  const routes = useMemo<CommandEntry[]>(() => {
    const list: Array<[string, string, ReactNode]> = [
      [t("ws.nav.overview"), "/app", <LayoutDashboard key="overview" size={15} />],
      [t("ws.nav.projects"), "/app/projects", <FolderKanban key="projects" size={15} />],
      ["WORLD", "/app/modules/world", <Globe2 key="world" size={15} />],
      ["FLOW", "/app/modules/flow", <RouteIcon key="flow" size={15} />],
      ["EXIT", "/app/modules/exit", <PackageOpen key="exit" size={15} />],
      [t("ws.nav.cli"), "/app/cli", <Terminal key="cli" size={15} />],
      [t("ws.nav.billing"), "/app/billing", <CreditCard key="billing" size={15} />],
      [t("ws.nav.settings"), "/app/settings", <SettingsIcon key="settings" size={15} />],
    ];
    if (session.isAdmin) {
      list.push([t("ws.nav.operations"), "/app/admin", <ShieldCheck key="admin" size={15} />]);
    }
    return list.map(([label, to, icon]) => ({ label, to, icon, group: "routes" as const }));
  }, [session.isAdmin, t]);

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
        <div className="app-frame app-loading-frame">
          <div className="app-loader" aria-label={t("ws.loading")} aria-live="polite">
            <span className="sr-only">Loading</span>
          </div>
          <p className="app-eyebrow">{t("ws.loading")}</p>
        </div>
      </div>
    );
  }

  if (session.status === "signed_out") {
    return <Navigate to={`/signin?next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  if (session.status === "unreachable") {
    return (
      <div className="app-shell app-centered-shell">
        <div className="app-frame app-service-frame">
          <p className="app-eyebrow">PROOFSTACK / 503</p>
          <h1 className="app-display app-service-title">{t("ws.service.title")}</h1>
          <p className="app-support">{t("ws.service.body")}</p>
          <button
            type="button"
            className="app-btn app-btn-primary mt-6"
            onClick={() => void session.refresh()}
          >
            {t("ws.service.retry")}
          </button>
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
  const enginesActive = location.pathname.startsWith("/app/modules/");

  return (
    <div className="app-shell">
      <div className="app-frame">
        <header className="app-topbar">
          <NavLink to="/app" className="app-brand-lockup" aria-label="PROOFSTACK workspace">
            <Mark size={34} variant="onLight" />
            <span className="wordmark app-brand-word">ROOFSTACK</span>
            <span className="app-beta">{t("ws.shell.beta")}</span>
          </NavLink>

          <nav className="app-desktop-nav" aria-label={t("ws.nav.menu")}>
            <NavLink to="/app" end className="app-toplink">
              {t("ws.nav.overview")}
            </NavLink>
            <NavLink to="/app/projects" className="app-toplink">
              {t("ws.nav.projects")}
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
                </div>
              ) : null}
            </div>
            <NavLink to="/app/cli" className="app-toplink">
              {t("ws.nav.cli")}
            </NavLink>
            <NavLink to="/app/billing" className="app-toplink">
              {t("ws.nav.billing")}
            </NavLink>
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
              className="app-btn"
              aria-label={t("ws.shell.enable3d")}
              onClick={toggleThreeD}
              aria-pressed={threeDEnabled}
              title="3D mode"
            >
              <Box size={14} /> 3D
            </button>

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
          </div>
        </header>

        <main id="main" className="app-main">
          <Outlet />
        </main>

        <footer className="app-footer">
          <span>PROOFSTACK / {workspace?.name ?? "workspace"}</span>
          <span>LOCAL EXECUTION / CLOUD EVIDENCE</span>
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
              <span className="wordmark app-brand-word">ROOFSTACK</span>
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
                  activate(filtered[selected]!);
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
    eyebrow ?? (locale === "fr" ? "PROOFSTACK / espace de travail" : "PROOFSTACK / workspace");
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
