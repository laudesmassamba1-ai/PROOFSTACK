import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger, CustomEase);

/**
 * The one easing of the product (MOTION_GUIDELINES, proofstack-product-experience §8):
 * cubic-bezier(.2,.8,.2,1). Expressed as a GSAP CustomEase so GSAP tweens and Lenis share it.
 */
const INK = CustomEase.create("ink", "M0,0 C0.2,0.8 0.2,1 1,1");

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

/** Set once the headline has risen in this page session. Route changes never replay it. */
let headlineRevealed = false;

/** One source of truth for the reduced-motion decision. Every motion path asks this. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.(REDUCED_QUERY).matches === true;
}

/**
 * Smooth scroll for the marketing site only. The workspace keeps native scrolling because
 * it contains nested scroll regions (chat, terminal, tables) that a window-level smoother
 * would fight. Returns a teardown; reduced motion gets the native scroll untouched.
 */
export function startSmoothScroll(): () => void {
  if (prefersReducedMotion()) return () => {};

  const lenis = new Lenis({
    duration: 1.15,
    easing: (t: number) => INK(t),
    smoothWheel: true,
  });
  lenis.on("scroll", ScrollTrigger.update);

  const tick = (time: number) => lenis.raf(time * 1000);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);

  return () => {
    gsap.ticker.remove(tick);
    lenis.destroy();
  };
}

/**
 * Line-by-line rise of a headline, first load only (MOTION_GUIDELINES: "lines rise 10–14px on
 * first load only; not on every route change"). The words are rendered by React
 * (SplitHeadline); GSAP only writes transforms to nodes React owns.
 */
export function riseWords(scope: HTMLElement): () => void {
  if (headlineRevealed || prefersReducedMotion()) return () => {};
  headlineRevealed = true;
  const ctx = gsap.context(() => {
    gsap.from(".split-word", {
      y: 12,
      opacity: 0,
      duration: 0.45,
      ease: INK,
      stagger: 0.04,
      delay: 0.05,
    });
  }, scope);
  return () => ctx.revert();
}

/**
 * Module object settle: opacity and an 8–12px translation, once, when the grid reaches the
 * viewport. Inline transform/opacity are cleared afterwards so CSS hover transforms keep working.
 */
export function revealCards(scope: HTMLElement, selector: string): () => void {
  if (prefersReducedMotion()) return () => {};
  const ctx = gsap.context(() => {
    gsap.from(selector, {
      y: 10,
      opacity: 0,
      duration: 0.4,
      ease: INK,
      stagger: 0.05,
      clearProps: "transform,opacity",
      scrollTrigger: { trigger: scope, start: "top 84%", once: true },
    });
  }, scope);
  return () => ctx.revert();
}
