import {
  Activity,
  BadgeCheck,
  BookOpen,
  Boxes,
  Brain,
  CreditCard,
  FolderPlus,
  Globe2,
  LayoutDashboard,
  LayoutGrid,
  PackageOpen,
  Route as RouteIcon,
  ScanLine,
  Settings,
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
 * les approche ; Modules et Espaces portent un sous-menu qui se déplie au
 * survol — le clic bascule le menu fermé, un clic dans le menu navigue.
 * Toutes les sections de l'application sont joignables depuis ici, quel que
 * soit le mode (simple ou expert).
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
      icon: <Activity size={20} />,
      label: "Analyses",
      onClick: go("/app/analyses"),
    },
    {
      icon: <LayoutGrid size={20} />,
      label: fr ? "Modules" : "Modules",
      onClick: go("/app/modules"),
      menu: [
        {
          icon: <LayoutGrid size={15} />,
          label: fr ? "Vue d'ensemble" : "Overview",
          onClick: go("/app/modules"),
        },
        { icon: <Globe2 size={15} />, label: "WORLD", onClick: go("/app/modules/world") },
        { icon: <RouteIcon size={15} />, label: "FLOW", onClick: go("/app/modules/flow") },
        { icon: <PackageOpen size={15} />, label: "EXIT", onClick: go("/app/modules/exit") },
        { icon: <ShieldAlert size={15} />, label: "FAIL", onClick: go("/app/modules/fail") },
        { icon: <BadgeCheck size={15} />, label: "CLEAN", onClick: go("/app/modules/clean") },
        {
          icon: <ScanLine size={15} />,
          label: fr ? "Scanner une adresse" : "Scan an address",
          onClick: go("/app/scan"),
        },
        {
          icon: <Boxes size={15} />,
          label: fr ? "Interaction navigateur" : "Browser interaction",
          onClick: go("/app/interact"),
        },
      ],
    },
    {
      icon: <Brain size={20} />,
      label: "IA",
      onClick: go("/app/ai"),
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
      icon: <Boxes size={20} />,
      label: fr ? "Espaces" : "Workspaces",
      onClick: go("/app/workspace"),
      menu: [
        {
          icon: <Boxes size={15} />,
          label: fr ? "Espaces de travail" : "Workspaces",
          onClick: go("/app/workspace"),
        },
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
      gap={8}
      showIndicators={false}
      className="quick-dock"
    />
  );
}
