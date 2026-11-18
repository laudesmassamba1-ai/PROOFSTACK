/**
 * Scroll-choreographed reveals, the "After Effects timeline" pass.
 *
 * Elements carrying `[data-reveal]` start blurred and offset; an
 * IntersectionObserver adds `.is-in` as each enters the viewport, with a
 * stagger driven by the element's order among its reveal siblings
 * (`--reveal-delay`).
 *
 * Workspace pages load their data *after* mount, so sections can appear at any
 * time — a MutationObserver on the document registers late arrivals too.
 * Everything is disabled under `prefers-reduced-motion` (content is visible
 * immediately), and if scripting of a page fails there is a last-resort sweep
 * that reveals anything still hidden after 3s.
 */

let intersectionObserver: IntersectionObserver | null = null;
let mutationObserver: MutationObserver | null = null;
let sweepTimer = 0;
const armed = new WeakSet<Element>();

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

function ensureIntersectionObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === "undefined") return null;
  if (intersectionObserver) return intersectionObserver;
  intersectionObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          intersectionObserver?.unobserve(entry.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
  );
  return intersectionObserver;
}

function arm(node: HTMLElement): void {
  if (armed.has(node)) return;
  armed.add(node);
  if (reducedMotion()) {
    node.classList.add("is-in");
    return;
  }
  const io = ensureIntersectionObserver();
  if (!io) {
    node.classList.add("is-in");
    return;
  }
  // Stagger siblings that share a row; a new row resets the stagger, so a
  // section reveals like a sequence of keyframes, top to bottom.
  const rect = node.getBoundingClientRect();
  const siblings = document.querySelectorAll<HTMLElement>("[data-reveal]");
  let index = 0;
  for (const sibling of siblings) {
    if (sibling === node) break;
    if (Math.abs(sibling.getBoundingClientRect().top - rect.top) < 60) index += 1;
  }
  node.style.setProperty("--reveal-delay", `${Math.min(index * 90, 540)}ms`);
  io.observe(node);
}

function armAll(): void {
  for (const node of document.querySelectorAll<HTMLElement>("[data-reveal]")) arm(node);
}

function scheduleArmAll(): void {
  if (sweepTimer) return;
  sweepTimer = window.setTimeout(() => {
    sweepTimer = 0;
    armAll();
  }, 60);
}

export function initReveals(): void {
  if (reducedMotion()) {
    for (const node of document.querySelectorAll<HTMLElement>("[data-reveal]")) {
      node.classList.add("is-in");
    }
    return;
  }
  armAll();
  // Workspace sections mount after their data arrives; watch for late arrivals.
  if (!mutationObserver && typeof MutationObserver !== "undefined") {
    mutationObserver = new MutationObserver(scheduleArmAll);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
  }
  // Last resort: nothing in view may stay invisible forever. Three seconds
  // after init, anything that is inside the viewport but still hidden fades in
  // instantly; below-the-fold elements keep their scroll reveal.
  window.setTimeout(() => {
    for (const node of document.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-in)")) {
      const { top, bottom } = node.getBoundingClientRect();
      if (top < window.innerHeight && bottom > 0) {
        node.style.transitionDuration = "1ms";
        node.classList.add("is-in");
      }
    }
  }, 3000);
}

export function teardownReveals(): void {
  intersectionObserver?.disconnect();
  mutationObserver?.disconnect();
  mutationObserver = null;
  if (sweepTimer) window.clearTimeout(sweepTimer);
  sweepTimer = 0;
}
