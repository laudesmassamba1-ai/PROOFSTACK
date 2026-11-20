import { useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { WindowControls } from "../components/app/WindowControls.js";
import { Mark } from "../components/brand/Logo.js";
import { Footer } from "../components/marketing/Footer.js";
import { Nav } from "../components/marketing/Nav.js";
import { startSmoothScroll } from "../lib/choreography.js";
import { initCinema, teardownCinema } from "../lib/cinema.js";
import { initReveals, teardownReveals } from "../lib/reveal.js";

/** Routes that exist to open a session, not to sell the product. */
const DESKTOP_AUTH_ROUTES = new Set([
  "/signin",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/device",
]);

export function BrandLayout() {
  const { pathname } = useLocation();

  // Reset scroll on navigation. pathname is the trigger by design.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname IS the dependency
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [pathname]);

  // Lenis smooth scroll for the marketing shell only (the workspace is AppLayout and keeps
  // native scroll). Mounted once per shell; reduced motion is handled inside startSmoothScroll.
  useEffect(() => startSmoothScroll(), []);

  // Two engines, two vocabularies: `data-reveal` for the shared blurred rise used by
  // the workspace sections, `data-anim` for the site's choreography (character masks,
  // wipes, springs). Both are idempotent and both re-arm per route.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname IS the dependency
  useEffect(() => {
    const timer = window.setTimeout(() => {
      initReveals();
      initCinema();
    }, 60);
    return () => {
      window.clearTimeout(timer);
      teardownReveals();
      teardownCinema();
    };
  }, [pathname]);

  // Inside the native window, the marketing header and footer are noise: they advertise a
  // site the user already installed, and they turn a 1180px app window into a clipped
  // browser page. Account routes get the app's own draggable title bar instead.
  if (
    typeof window !== "undefined" &&
    window.proofcoreDesktop &&
    DESKTOP_AUTH_ROUTES.has(pathname)
  ) {
    return (
      <div className="desktop-auth-shell">
        <header className="desktop-auth-bar">
          <span className="desktop-auth-brand">
            <Mark size={26} />
            <span className="wordmark desktop-auth-wordmark">ROOFCORE</span>
          </span>
          <span className="desktop-auth-context">COMPTE / MOTEUR LOCAL</span>
          <WindowControls />
        </header>
        <main id="main" className="desktop-auth-main">
          <Outlet />
        </main>
        <footer className="desktop-auth-foot">
          <span>PROOFCORE / accès sécurisé</span>
          <span>WORLD · FLOW · EXIT · FAIL · CLEAN</span>
        </footer>
      </div>
    );
  }

  return (
    <div className="brand-shell min-h-screen">
      <Nav />
      <main id="main" className="pt-[4.5rem]">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

export function Section({
  children,
  className = "",
  id,
  tone = "dark",
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
  tone?: "dark" | "deeper";
}) {
  // One measure for every band (1280px), one vertical rhythm per section. A "deeper"
  // band is full-bleed so its background never reads as a floating rectangle.
  const inner = `cine-section relative mx-auto max-w-[1280px] px-5 sm:px-6 lg:px-10 ${className}`;

  if (tone === "deeper") {
    return (
      <div className="section-deeper" data-tone="deeper">
        <section id={id} className={inner}>
          {children}
        </section>
      </div>
    );
  }

  return (
    <section id={id} className={inner}>
      {children}
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lede,
  index,
  level = 2,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  /** Editorial section number ("02 / MODULES"). Decorative, skipped by screen readers. */
  index?: string;
  /**
   * Heading level. A page whose first block is a SectionHeading must pass 1: a document
   * with no h1 is a real accessibility defect (screen readers announce no page title) and
   * five marketing pages shipped that way. Inner sections keep the default.
   */
  level?: 1 | 2;
}) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <header className="cine-section-head" data-anim="fade">
      <div className="min-w-0">
        {index ? (
          <p className="cine-section-index" aria-hidden="true">
            {index}
          </p>
        ) : null}
        {eyebrow ? <p className="eyebrow mt-4">{eyebrow}</p> : null}
        <Heading className="cine-section-title">{title}</Heading>
      </div>
      {lede ? <p className="cine-section-lede">{lede}</p> : null}
    </header>
  );
}
