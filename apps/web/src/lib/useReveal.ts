/**
 * Reveal-on-scroll for React components — the small, dependency-free cousin of
 * lib/reveal.ts. Attach the returned ref to a container carrying the `.reveal`
 * class; an IntersectionObserver adds `.is-in` the first time it enters the
 * viewport, and CSS does the rest (see the `.reveal` block in global.css:
 * rise + fade, staggered per element with the `--d` custom property).
 *
 * The visual state is owned entirely by CSS classes — never JS-set inline
 * styles — so the global `prefers-reduced-motion` reset (every animation and
 * transition forced to 0.001ms) ends each entrance instantly for readers who
 * asked for calm. Reduced motion also short-circuits here: the class is added
 * immediately, before first paint of the effect.
 *
 * `inView` is exposed for the one case that needs JS beyond a class: the
 * count-up numbers on the landing stats strip.
 */
import { type RefObject, useEffect, useRef, useState } from "react";

export interface UseRevealResult<T extends HTMLElement> {
  ref: RefObject<T | null>;
  /** True once the element has entered the viewport at least once. */
  inView: boolean;
}

export function useReveal<T extends HTMLElement>(
  options: { rootMargin?: string; threshold?: number } = {}
): UseRevealResult<T> {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  const { rootMargin = "0px 0px -8% 0px", threshold = 0.08 } = options;

  useEffect(() => {
    const node = ref.current;
    if (!node || inView) return;

    if (
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
    ) {
      node.classList.add("is-in");
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          setInView(true);
          observer.disconnect();
          break;
        }
      },
      { rootMargin, threshold }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [inView, rootMargin, threshold]);

  return { ref, inView };
}
