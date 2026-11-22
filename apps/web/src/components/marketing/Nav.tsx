import { ChevronDown, Languages, Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { useI18n } from "../../i18n/index.js";
import { useDAMode } from "../../lib/da.js";
import { Wordmark } from "../brand/Logo.js";

/**
 * The header is deliberately short.
 *
 * It used to list all ten destinations inline, which pushed the primary call to action
 * past the right edge of a 1440px window — the one button the page exists for was
 * clipped. Ten equal links also said "here is a sitemap" instead of "here is a product".
 * The five modules now live under one labelled menu, which keeps the bar to five entries
 * and lets the two actions breathe at every width from 320px up.
 */
const LINKS = [
  { to: "/product", key: "nav.product" as const },
  { to: "/platform", key: "nav.platform" as const },
  { to: "/pricing", key: "nav.pricing" as const },
  { to: "/docs", key: "nav.docs" as const },
];

const MODULES = [
  {
    to: "/world",
    id: "world",
    key: "modules.world.name" as const,
    tag: "modules.world.tag" as const,
  },
  { to: "/flow", id: "flow", key: "modules.flow.name" as const, tag: "modules.flow.tag" as const },
  { to: "/exit", id: "exit", key: "modules.exit.name" as const, tag: "modules.exit.tag" as const },
  { to: "/fail", id: "fail", key: "modules.fail.name" as const, tag: "modules.fail.tag" as const },
  {
    to: "/clean",
    id: "clean",
    key: "modules.clean.name" as const,
    tag: "modules.clean.tag" as const,
  },
];

export function Nav() {
  const da = useDAMode();
  const { t, locale, setLocale } = useI18n();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [modulesOpen, setModulesOpen] = useState(false);
  const modulesRef = useRef<HTMLLIElement | null>(null);
  const location = useLocation();

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the menus on navigation and on Escape — a menu you cannot dismiss with the
  // keyboard is a trap for anyone not using a pointer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname IS the dependency
  useEffect(() => {
    setOpen(false);
    setModulesOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!modulesOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setModulesOpen(false);
    };
    const onPointer = (event: PointerEvent): void => {
      if (!modulesRef.current?.contains(event.target as Node)) setModulesOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [modulesOpen]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-white/10 bg-[#050708]/82 backdrop-blur-xl"
          : "border-b border-transparent"
      }`}
    >
      <nav className="mx-auto flex max-w-[1240px] items-center gap-3 px-5 py-3.5 lg:px-8">
        <Link to="/" aria-label={t("mkt.homeLabel")} className="shrink-0">
          <Wordmark size={15} variant={da === "light" ? "onLight" : "default"} />
        </Link>

        <ul className="ml-3 hidden items-center gap-0.5 lg:flex">
          {LINKS.slice(0, 1).map((link) => (
            <li key={link.to}>
              <NavLink to={link.to} className={linkClass}>
                {t(link.key)}
              </NavLink>
            </li>
          ))}

          <li ref={modulesRef} className="relative">
            <button
              type="button"
              onClick={() => setModulesOpen((value) => !value)}
              aria-expanded={modulesOpen}
              aria-haspopup="true"
              className={`${linkClass({ isActive: false })} inline-flex items-center gap-1.5`}
            >
              {t("nav.modules")}
              <ChevronDown
                size={14}
                className={`transition-transform duration-200 ${modulesOpen ? "rotate-180" : ""}`}
              />
            </button>
            {modulesOpen ? (
              <div className="nav-flyout" role="menu">
                <p className="nav-flyout-label">{t("nav.modules.lede")}</p>
                {MODULES.map((module) => (
                  <Link
                    key={module.to}
                    to={module.to}
                    role="menuitem"
                    className={`nav-flyout-item module-${module.id}`}
                  >
                    <span className="nav-flyout-dot" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="nav-flyout-name">{t(module.key)}</span>
                      <span className="nav-flyout-tag">{t(module.tag)}</span>
                    </span>
                  </Link>
                ))}
              </div>
            ) : null}
          </li>

          {LINKS.slice(1).map((link) => (
            <li key={link.to}>
              <NavLink to={link.to} className={linkClass}>
                {t(link.key)}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="ml-auto hidden items-center gap-2 lg:flex">
          <button
            type="button"
            onClick={() => setLocale(locale === "en" ? "fr" : "en")}
            className="flex items-center gap-1.5 rounded-full border border-white/12 px-2.5 py-1.5 text-[0.75rem] text-white/72 transition-colors hover:border-brand-mint/60 hover:text-white"
            aria-label={t("nav.language")}
          >
            <Languages size={14} />
            {locale.toUpperCase()}
          </button>
          <Link to="/signin" className="btn btn-ghost">
            {t("nav.signin")}
          </Link>
          <Link to="/signup" className="btn btn-primary nav-cta">
            {t("nav.cta")}
          </Link>
        </div>

        <button
          type="button"
          className="ml-auto rounded-lg border border-white/15 p-2 text-white lg:hidden"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? t("mkt.menu.close") : t("mkt.menu.open")}
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </nav>

      {open ? (
        <div
          id="mobile-nav"
          className="max-h-[calc(100dvh-4.25rem)] overflow-y-auto border-y border-white/10 bg-[#050708] px-5 py-4 shadow-2xl lg:hidden"
        >
          <ul className="flex flex-col gap-1">
            {LINKS.map((link) => (
              <li key={link.to}>
                <Link
                  to={link.to}
                  className="block rounded-lg px-3 py-2.5 text-[0.95rem] text-white/82 hover:bg-white/8"
                >
                  {t(link.key)}
                </Link>
              </li>
            ))}
          </ul>

          <p className="mt-4 px-3 font-mono text-[0.62rem] tracking-[0.2em] text-white/34">
            {t("nav.modules").toUpperCase()}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {MODULES.map((module) => (
              <li key={module.to}>
                <Link
                  to={module.to}
                  className={`nav-flyout-item module-${module.id} mx-0`}
                  style={{ marginInline: 0 }}
                >
                  <span className="nav-flyout-dot" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="nav-flyout-name">{t(module.key)}</span>
                    <span className="nav-flyout-tag">{t(module.tag)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLocale(locale === "en" ? "fr" : "en")}
              className="btn btn-ghost flex-1 justify-center"
            >
              <Languages size={15} /> {locale === "en" ? "Français" : "English"}
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

function linkClass({ isActive }: { isActive: boolean }): string {
  return `rounded-full px-3 py-2 text-[0.85rem] transition-colors ${
    isActive ? "bg-white/10 text-white" : "text-white/62 hover:text-white"
  }`;
}
