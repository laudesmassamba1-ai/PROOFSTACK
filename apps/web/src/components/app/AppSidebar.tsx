import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  BookOpen,
  Brain,
  ChevronsLeft,
  ChevronsRight,
  CreditCard,
  FolderKanban,
  Globe2,
  LayoutDashboard,
  PackageOpen,
  Radar,
  Route as RouteIcon,
  Settings as SettingsIcon,
  ShieldAlert,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { useI18n } from "../../i18n/index.js";

/**
 * Barre latérale repliable de l'espace de travail — adaptation maison du
 * bloc « sidebar-07 » de shadcn/ui (sidebar qui se replie en icônes) : un
 * rail d'icônes avec infobulles, un état étendu avec libellés et
 * sous-navigation, un bouton de repli persistant dans localStorage, et une
 * transition de largeur sur une courbe douce. Aucune dépendance radix :
 * mêmes interactions, écrit avec la pile du projet.
 */

type Item = {
  to: string;
  labelKey?: string;
  fallback: { fr: string; en: string };
  icon: LucideIcon;
  end?: boolean;
  studioOnly?: boolean;
};

type Group = { label: { fr: string; en: string }; items: Item[] };

const GROUPS: Group[] = [
  {
    label: { fr: "Pilotage", en: "Steering" },
    items: [
      {
        to: "/app",
        labelKey: "ws.nav.overview",
        fallback: { fr: "Vue d'ensemble", en: "Overview" },
        icon: LayoutDashboard,
        end: true,
      },
      {
        to: "/app/projects",
        labelKey: "ws.nav.projects",
        fallback: { fr: "Projets", en: "Projects" },
        icon: FolderKanban,
      },
      {
        to: "/app/modules",
        labelKey: "ws.nav.engines",
        fallback: { fr: "Modules", en: "Modules" },
        icon: ShieldCheck,
        studioOnly: true,
      },
    ],
  },
  {
    label: { fr: "Outils", en: "Tools" },
    items: [
      {
        to: "/app/start",
        fallback: { fr: "Analyser", en: "Scan" },
        icon: Radar,
      },
      {
        to: "/app/interact",
        fallback: { fr: "Interaction", en: "Interaction" },
        icon: Globe2,
        studioOnly: true,
      },
      {
        to: "/app/cli",
        labelKey: "ws.nav.cli",
        fallback: { fr: "CLI", en: "CLI" },
        icon: Terminal,
        studioOnly: true,
      },
      {
        to: "/app/ai",
        labelKey: "ws.nav.ai",
        fallback: { fr: "IA", en: "AI" },
        icon: Brain,
        studioOnly: true,
      },
      {
        to: "/app/guide",
        fallback: { fr: "Guide", en: "Guide" },
        icon: BookOpen,
      },
    ],
  },
  {
    label: { fr: "Espace", en: "Workspace" },
    items: [
      {
        to: "/app/notifications",
        labelKey: "app.nav.notifications",
        fallback: { fr: "Notifications", en: "Notifications" },
        icon: ShieldAlert,
      },
      {
        to: "/app/billing",
        labelKey: "ws.nav.billing",
        fallback: { fr: "Facturation", en: "Billing" },
        icon: CreditCard,
      },
      {
        to: "/app/settings",
        labelKey: "ws.nav.settings",
        fallback: { fr: "Réglages", en: "Settings" },
        icon: SettingsIcon,
      },
      {
        to: "/app/workspace",
        labelKey: "ws.nav.workspace",
        fallback: { fr: "Espace", en: "Workspace" },
        icon: PackageOpen,
        studioOnly: true,
      },
    ],
  },
];

const MODULE_ITEMS: Item[] = [
  { to: "/app/modules/world", fallback: { fr: "WORLD", en: "WORLD" }, icon: Globe2 },
  { to: "/app/modules/flow", fallback: { fr: "FLOW", en: "FLOW" }, icon: RouteIcon },
  { to: "/app/modules/exit", fallback: { fr: "EXIT", en: "EXIT" }, icon: PackageOpen },
  { to: "/app/modules/fail", fallback: { fr: "FAIL", en: "FAIL" }, icon: ShieldAlert },
  { to: "/app/modules/clean", fallback: { fr: "CLEAN", en: "CLEAN" }, icon: BadgeCheck },
];

export function AppSidebar({
  unreadCount = 0,
  advanced,
  workspaceName,
  roleLabel,
}: {
  unreadCount?: number;
  advanced: boolean;
  workspaceName?: string;
  roleLabel?: string;
}) {
  const { t, locale } = useI18n();
  const fr = locale === "fr";
  const location = useLocation();
  const [rail, setRail] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("proofcore.sidebar") === "rail";
    } catch {
      return false;
    }
  });
  const [modulesOpen, setModulesOpen] = useState(() =>
    location.pathname.startsWith("/app/modules")
  );

  useEffect(() => {
    document.documentElement.style.setProperty("--sbw", rail ? "60px" : "238px");
    try {
      window.localStorage.setItem("proofcore.sidebar", rail ? "rail" : "expanded");
    } catch {
      /* mode privé : l'état vit pour la session */
    }
  }, [rail]);

  useEffect(() => {
    if (location.pathname.startsWith("/app/modules")) setModulesOpen(true);
  }, [location.pathname]);

  const label = (item: Item): string =>
    item.labelKey ? t(item.labelKey as never) : item.fallback[fr ? "fr" : "en"];

  return (
    <aside className={`app-sidebar${rail ? " is-rail" : ""}`} data-rail={rail ? "true" : "false"}>
      <div className="sb-head" data-tip={workspaceName ?? "PROOFCORE"}>
        <span className="sb-head-mark">
          <ShieldCheck size={15} />
        </span>
        <span className="sb-head-name">
          {workspaceName ?? "PROOFCORE"}
          <span className="sb-head-role">{roleLabel ?? (fr ? "ESPACE" : "WORKSPACE")}</span>
        </span>
      </div>
      <nav
        className="app-sidebar-nav"
        aria-label={fr ? "Navigation de l'espace" : "Workspace navigation"}
      >
        {GROUPS.map((group) => {
          const items = group.items.filter((item) => advanced || !item.studioOnly);
          if (items.length === 0) return null;
          return (
            <div key={group.label.en} className="sb-group">
              <p className="sb-group-label">{group.label[fr ? "fr" : "en"]}</p>
              <ul className="sb-list">
                {items.map((item) => {
                  const Icon = item.icon;
                  const isModules = item.to === "/app/modules";
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        className="sb-item"
                        data-tip={label(item)}
                        onClick={
                          isModules
                            ? (event) => {
                                if (location.pathname === "/app/modules") {
                                  event.preventDefault();
                                  setModulesOpen((value) => !value);
                                }
                              }
                            : undefined
                        }
                      >
                        <Icon size={17} className="sb-icon" />
                        <span className="sb-label">{label(item)}</span>
                        {item.to === "/app/notifications" && unreadCount > 0 ? (
                          <span className="sb-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>
                        ) : null}
                        {isModules && !rail ? (
                          <button
                            type="button"
                            className="sb-caret"
                            aria-expanded={modulesOpen}
                            aria-label={fr ? "Replier les modules" : "Collapse modules"}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setModulesOpen((value) => !value);
                            }}
                          >
                            ›
                          </button>
                        ) : null}
                      </NavLink>
                      {isModules && !rail && modulesOpen ? (
                        <ul className="sb-sublist">
                          {MODULE_ITEMS.map((module) => {
                            const ModuleIcon = module.icon;
                            return (
                              <li key={module.to}>
                                <NavLink
                                  to={module.to}
                                  className="sb-item sb-item-sub"
                                  data-tip={module.fallback[fr ? "fr" : "en"]}
                                >
                                  <ModuleIcon size={14} className="sb-icon" />
                                  <span className="sb-label">
                                    {module.fallback[fr ? "fr" : "en"]}
                                  </span>
                                </NavLink>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <button
        type="button"
        className="sb-toggle"
        data-tip={rail ? (fr ? "Déplier" : "Expand") : fr ? "Replier" : "Collapse"}
        onClick={() => setRail((value) => !value)}
        aria-label={
          rail
            ? fr
              ? "Déplier la barre latérale"
              : "Expand the sidebar"
            : fr
              ? "Replier la barre latérale"
              : "Collapse the sidebar"
        }
      >
        {rail ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
        <span className="sb-label">{rail ? "" : fr ? "Replier" : "Collapse"}</span>
      </button>
    </aside>
  );
}
