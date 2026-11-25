import {
  BadgeCheck,
  BookOpen,
  CreditCard,
  FolderPlus,
  Globe2,
  LayoutDashboard,
  LayoutGrid,
  PackageOpen,
  Route as RouteIcon,
  ScanLine,
  Settings,
  Settings2,
  ShieldAlert,
  Terminal,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useI18n } from "../../i18n/index.js";
import { useTheme } from "../../lib/theme.js";
import Dock from "./Dock.js";

/**
 * QuickDock — React Bits Dock (MIT), la navigation de bureau.
 *
 * Les tuiles grossissent avec une vraie physique à ressort quand le pointeur
 * les approche ; deux tuiles portent un sous-menu qui se déplie au survol
 * (Modules, Espace) — le clic bascule le menu fermé, un clic dans le menu
 * navigue. La barre latérale n'existe plus sur bureau : le dock est la
 * navigation ; sur mobile il laisse place à la feuille hamburger.
 */
export function QuickDock() {
  const navigate = useNavigate();
  const { locale } = useI18n();
  const { theme } = useTheme();
  const fr = locale === "fr";

  const go = (to: string) => () => navigate(to);

  const items = [
    {
      icon: <LayoutDashboard size={20} />,
      label: fr ? "Vue d'ensemble" : "Overview",
      onClick: go("/app"),
    },
    {
      icon: <FolderPlus size={20} />,
      label: fr ? "Projets" : "Projects",
      onClick: go("/app/projects"),
    },
    {
      icon: <ScanLine size={20} />,
      label: fr ? "Analyser une adresse" : "Scan an address",
      onClick: go("/app/start"),
    },
    {
      icon: <LayoutGrid size={20} />,
      label: fr ? "Modules" : "Modules",
      onClick: () => navigate("/app/modules"),
      menu: [
        { icon: <Globe2 size={15} />, label: "WORLD", onClick: go("/app/modules/world") },
        { icon: <RouteIcon size={15} />, label: "FLOW", onClick: go("/app/modules/flow") },
        { icon: <PackageOpen size={15} />, label: "EXIT", onClick: go("/app/modules/exit") },
        { icon: <ShieldAlert size={15} />, label: "FAIL", onClick: go("/app/modules/fail") },
        { icon: <BadgeCheck size={15} />, label: "CLEAN", onClick: go("/app/modules/clean") },
      ],
    },
    {
      icon: <Terminal size={20} />,
      label: fr ? "Terminal / CLI" : "Terminal / CLI",
      onClick: go("/app/cli"),
    },
    {
      icon: <BookOpen size={20} />,
      label: fr ? "Guide" : "Guide",
      onClick: go("/app/guide"),
    },
    {
      icon: <Settings2 size={20} />,
      label: fr ? "Espace" : "Workspace",
      onClick: go("/app/settings"),
      menu: [
        {
          icon: <CreditCard size={15} />,
          label: fr ? "Facturation" : "Billing",
          onClick: go("/app/billing"),
        },
        {
          icon: <Settings size={15} />,
          label: fr ? "Paramètres" : "Settings",
          onClick: go("/app/settings"),
        },
      ],
    },
  ];

  return (
    <Dock
      items={items}
      position="bottom"
      theme={theme === "dark" ? "noir" : "paper"}
      accentColor="#e4381f"
      baseItemSize={42}
      magnification={64}
      panelHeight={56}
      distance={140}
      showIndicators={false}
      className="quick-dock"
    />
  );
}
