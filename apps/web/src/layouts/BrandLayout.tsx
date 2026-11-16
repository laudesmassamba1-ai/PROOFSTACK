import { Outlet, useLocation } from "react-router";
import { useEffect } from "react";
import { Nav } from "../components/marketing/Nav.js";
import { Footer } from "../components/marketing/Footer.js";

export function BrandLayout() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [pathname]);

  return (
    <div className="brand-shell min-h-screen">
      <Nav />
      <main id="main" className="pt-24">
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
  return (
    <section
      id={id}
      className={`mx-auto max-w-[1240px] px-5 py-16 lg:px-8 lg:py-24 ${
        tone === "deeper" ? "bg-[#070a0c]" : ""
      } ${className}`}
    >
      {children}
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lede,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
}) {
  return (
    <header className="max-w-[62ch]">
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h2 className="mt-3 text-[1.9rem] leading-[1.12] tracking-tight sm:text-[2.4rem]">{title}</h2>
      {lede ? <p className="mt-4 text-[1rem] leading-relaxed text-white/56">{lede}</p> : null}
    </header>
  );
}
