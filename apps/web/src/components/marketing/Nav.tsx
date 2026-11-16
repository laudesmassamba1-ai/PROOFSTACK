import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { Languages, Menu, Moon, Sun, X } from "lucide-react";
import { Wordmark } from "../brand/Logo.js";
import { useI18n } from "../../i18n/index.js";
import { useTheme } from "../../lib/theme.js";

const LINKS = [
  { to: "/product", key: "nav.product" as const },
  { to: "/world", key: "modules.world.name" as const },
  { to: "/flow", key: "modules.flow.name" as const },
  { to: "/exit", key: "modules.exit.name" as const },
  { to: "/platform", key: "nav.platform" as const },
  { to: "/pricing", key: "nav.pricing" as const },
  { to: "/docs", key: "nav.docs" as const },
];

export function Nav() {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggle } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled ? "border-b border-white/10 bg-[#050708]/80 backdrop-blur-xl" : "border-b border-transparent"
      }`}
    >
      <nav className="mx-auto flex max-w-[1240px] items-center gap-6 px-5 py-4 lg:px-8">
        <Link to="/" aria-label="PROOFSTACK home">
          <Wordmark size={15} />
        </Link>

        <ul className="ml-4 hidden flex-1 items-center gap-1 lg:flex">
          {LINKS.map((link) => (
            <li key={link.to}>
              <NavLink
                to={link.to}
                className={({ isActive }) =>
                  `rounded-full px-3 py-2 text-[0.86rem] transition-colors ${
                    isActive ? "bg-white/10 text-white" : "text-white/62 hover:text-white"
                  }`
                }
              >
                {link.key === "modules.world.name" || link.key === "modules.flow.name" || link.key === "modules.exit.name"
                  ? link.key.split(".")[1]?.toUpperCase()
                  : t(link.key)}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="ml-auto hidden items-center gap-2 lg:flex">
          <button
            type="button"
            onClick={() => setLocale(locale === "en" ? "fr" : "en")}
            className="flex items-center gap-2 rounded-full border border-white/12 px-3 py-2 text-[0.78rem] text-white/72 transition-colors hover:border-brand-mint/60 hover:text-white"
            aria-label={t("nav.language")}
          >
            <Languages size={15} />
            {locale.toUpperCase()}
          </button>
          <button
            type="button"
            onClick={toggle}
            className="rounded-full border border-white/12 p-2 text-white/72 transition-colors hover:border-brand-mint/60 hover:text-white"
            aria-label={t("nav.theme")}
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <Link to="/signin" className="btn btn-ghost ml-1">
            {t("nav.signin")}
          </Link>
          <Link to="/signup" className="btn btn-primary">
            {t("nav.signup")}
          </Link>
        </div>

        <button
          type="button"
          className="ml-auto rounded-lg border border-white/15 p-2 text-white lg:hidden"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </nav>

      {open ? (
        <div id="mobile-nav" className="border-t border-white/10 bg-[#050708]/95 px-5 py-4 backdrop-blur-xl lg:hidden">
          <ul className="flex flex-col gap-1">
            {LINKS.map((link) => (
              <li key={link.to}>
                <Link to={link.to} className="block rounded-lg px-3 py-2.5 text-[0.95rem] text-white/80 hover:bg-white/8">
                  {t(link.key)}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLocale(locale === "en" ? "fr" : "en")}
              className="btn btn-ghost flex-1 justify-center"
            >
              <Languages size={15} /> {locale === "en" ? "Français" : "English"}
            </button>
            <button type="button" onClick={toggle} className="btn btn-ghost" aria-label={t("nav.theme")}>
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            <Link to="/signin" className="btn btn-ghost flex-1 justify-center">
              {t("nav.signin")}
            </Link>
            <Link to="/signup" className="btn btn-primary flex-1 justify-center">
              {t("nav.signup")}
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
