import { Bell, BookOpen, CreditCard, FolderPlus, ScanLine, Terminal } from "lucide-react";
import { useNavigate } from "react-router";
import { useI18n } from "../../i18n/index.js";
import { useTheme } from "../../lib/theme.js";
import Dock from "./Dock.js";

/**
 * QuickDock — React Bits Dock (MIT), monté en barre d'accès rapide.
 *
 * Les icônes grossissent avec une vraie physique à ressort quand le pointeur
 * les approche (la voisine s'écarte), l'étiquette apparaît au-dessus. Les
 * destinations sont celles de la barre latérale : le dock est le raccourci,
 * pas une seconde navigation.
 */
export function QuickDock({ unreadCount = 0 }: { unreadCount?: number }) {
  const navigate = useNavigate();
  const { locale } = useI18n();
  const { theme } = useTheme();
  const fr = locale === "fr";

  const items = [
    {
      icon: <ScanLine size={20} />,
      label: fr ? "Analyser une adresse" : "Scan an address",
      onClick: () => navigate("/app/start"),
    },
    {
      icon: <FolderPlus size={20} />,
      label: fr ? "Nouveau projet" : "New project",
      onClick: () => navigate("/app/projects"),
    },
    {
      icon: <Terminal size={20} />,
      label: fr ? "Configurer le CLI" : "Set up the CLI",
      onClick: () => navigate("/app/cli"),
    },
    {
      icon: <BookOpen size={20} />,
      label: fr ? "Guide" : "Guide",
      onClick: () => navigate("/app/guide"),
    },
    {
      icon: <Bell size={20} />,
      label: fr ? "Notifications" : "Notifications",
      onClick: () => navigate("/app/notifications"),
      badge: unreadCount > 0 ? (unreadCount > 9 ? "9+" : String(unreadCount)) : undefined,
    },
    {
      icon: <CreditCard size={20} />,
      label: fr ? "Facturation" : "Billing",
      onClick: () => navigate("/app/billing"),
    },
  ];

  return (
    <Dock
      items={items}
      position="bottom"
      theme={theme === "dark" ? "noir" : "paper"}
      accentColor="#e4381f"
      badgeColor="#e4381f"
      baseItemSize={42}
      magnification={64}
      panelHeight={56}
      distance={140}
      showIndicators={false}
      className="quick-dock"
    />
  );
}
