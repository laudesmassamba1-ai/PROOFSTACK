import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { WindowControls } from "../components/app/WindowControls.js";
import { DaComparer } from "../components/brand/DaComparer.js";
import { Mark } from "../components/brand/Logo.js";
import { SplitWords } from "../components/brand/SplitWords.js";
import { Footer } from "../components/marketing/Footer.js";
import { Nav } from "../components/marketing/Nav.js";
import { type DAMode, inIframe, resolveDAMode } from "../lib/da.js";
import { initMotion, teardownMotion } from "../lib/motion.js";
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

  // Scroll-choreographed reveals, re-armed per route. The motion engine adds the
  // split-word masks, spring tilts, magnetic controls and scroll drift on top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname IS the dependency
  useEffect(() => {
    const timer = window.setTimeout(() => {
      initReveals();
      initMotion();
    }, 60);
    return () => {
      window.clearTimeout(timer);
      teardownReveals();
      teardownMotion();
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

  // The visitor's art direction: remembered choice, or the comparer's URL override.
  const [da, setDa] = useState<DAMode>(() => resolveDAMode());

  // Inside a comparer pane the document hides its own scrollbar: the two panes
  // scroll together, so there is exactly one scrollbar on screen — the evidence
  // line the visitor drags.
  useEffect(() => {
    if (!inIframe()) return;
    document.documentElement.dataset.daPane = "1";
    return () => {
      delete document.documentElement.dataset.daPane;
    };
  }, []);

  // The comparer re-resolves after a choice is remembered.
  useEffect(() => {
    const onChange = () => setDa(resolveDAMode());
    window.addEventListener("storage", onChange);
    window.addEventListener("da-changed", onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener("da-changed", onChange);
    };
  }, []);

  return (
    <div className={`brand-shell min-h-screen`} data-da={da}>
      {/* the universe's atmosphere, fixed behind the pages */}
      <Nav />
      <main id="main" className="pt-24">
        <Outlet />
      </main>
      <Footer />
      {pathname === "/" ? <DaComparer /> : null}
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
  const inner = `mx-auto max-w-[1240px] px-5 py-14 sm:py-16 lg:px-8 lg:py-20 ${className}`;

  // A "deeper" band must be full-bleed: painting the background on the max-width box
  // left a visible inset rectangle floating on the page, which read as a rendering bug
  // rather than as sectioning.
  if (tone === "deeper") {
    return (
      <div className="section-deeper">
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
  as,
  eyebrow,
  title,
  lede,
}: {
  /** Page-level headings must be h1 (WCAG 1.3.1): the primary SectionHeading of a
   *  route declares `as="h1"`, every following one keeps the section default. */
  as?: "h1";
  eyebrow?: string;
  title: string;
  lede?: string;
}) {
  const Heading = as ?? "h2";
  return (
    <header className="max-w-[62ch]" data-reveal>
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      {/* The title is choreographed word by word: each rises out of its own mask with
          an anticipation curve, staggered asymmetrically by the motion engine. */}
      <Heading
        className="mt-3 text-balance text-[1.9rem] leading-[1.12] tracking-tight sm:text-[2.4rem]"
        data-motion="words"
      >
        <SplitWords text={title} />
      </Heading>
      {lede ? (
        <p className="mt-4 max-w-[64ch] text-[1rem] leading-relaxed text-white/56">{lede}</p>
      ) : null}
    </header>
  );
}
