/**
 * CINEMA ENGINE — the choreography layer of the brand site.
 *
 * A tiny, dependency-free animation runtime (the repo does not install motion
 * libraries). It provides the four techniques the art direction relies on:
 *
 *   data-anim="chars"   per-character mask reveal, prime-hashed stagger
 *   data-anim="words"   per-word mask reveal
 *   data-anim="fade"    blurred rise (sections, cards)
 *   data-anim="mask"    clip-path wipe for figures and headlines
 *   data-scrub="orbit"  scroll-linked rotation (rings, decorative layers)
 *   data-scrub          scroll-linked drift: --scrub-y / --scrub-scale
 *   data-magnet         underdamped spring follow for primary controls
 *   data-spot           pointer-tracked sheen (--spot-x / --spot-y)
 *
 * Contracts, all deliberate:
 *  - Nothing is hidden until `html.cine-ready` is set by this module, so a
 *    script failure or a no-JS reader sees the full page.
 *  - `prefers-reduced-motion: reduce` short-circuits: no split, no hidden state,
 *    no scroll loop, no springs.
 *  - A 3 s sweep reveals anything in the viewport that failed to arm.
 *  - Teardown restores split text and re-arms every flag, so route changes and
 *    StrictMode's double effect cannot leave a mutated DOM behind.
 *
 * Why geometry instead of IntersectionObserver: Chrome computes the intersection
 * rect from the target's own `clip-path`, so an element hidden with
 * `clip-path: inset(0 0 100% 0)` never intersects — the observer never fires and
 * the element stays hidden forever. Reading the border box and comparing it to the
 * viewport is immune to that, and it is the same amount of work for the ~20 nodes
 * a page arms.
 */

const SWEEP_MS = 3000;

type Cleanup = () => void;

let mutation: MutationObserver | null = null;
let sweep = 0;
let frame = 0;
let running = false;

const cleanups = new Set<Cleanup>();
const scrubItems = new Set<HTMLElement>();
const springs = new Set<Spring0>();
const pendingReveals = new Set<HTMLElement>();

/* ------------------------------------------------------------------ helpers */

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/** Deterministic pseudo-random in [0, spread) from an index. */
function jitter(index: number, spread: number): number {
  return ((Math.abs((index * 2654435761) % 1000) / 1000) * spread) | 0;
}

/* ------------------------------------------------------------------ springs */

interface Spring0 {
  node: HTMLElement;
  x: number;
  y: number;
  tx: number;
  ty: number;
  vx: number;
  vy: number;
  step: () => boolean;
  render: () => void;
}

function makeSpring(node: HTMLElement, render: () => void, stiffness = 210, damping = 17): Spring0 {
  const spring: Spring0 = {
    node,
    x: 0,
    y: 0,
    tx: 0,
    ty: 0,
    vx: 0,
    vy: 0,
    step: () => {
      const dt = 1 / 60;
      spring.vx += (spring.tx - spring.x) * stiffness * dt;
      spring.vy += (spring.ty - spring.y) * stiffness * dt;
      const decay = Math.exp(-damping * dt);
      spring.vx *= decay;
      spring.vy *= decay;
      spring.x += spring.vx * dt;
      spring.y += spring.vy * dt;
      const moving =
        Math.abs(spring.tx - spring.x) > 0.02 ||
        Math.abs(spring.ty - spring.y) > 0.02 ||
        Math.abs(spring.vx) > 0.02 ||
        Math.abs(spring.vy) > 0.02;
      spring.render();
      return moving;
    },
    render,
  };
  springs.add(spring);
  ensureLoop();
  return spring;
}

/* ------------------------------------------------------------- split text */

function splitChars(node: HTMLElement): Cleanup {
  if (node.dataset.split === "1") return () => undefined;
  const text = node.textContent ?? "";
  if (!text.trim()) return () => undefined;
  node.dataset.split = "1";
  node.setAttribute("aria-label", text);
  const fragment = document.createDocumentFragment();
  let index = 0;

  for (const word of text.split(/(\s+)/)) {
    if (!word) continue;
    if (/^\s+$/.test(word)) {
      const space = document.createElement("span");
      space.className = "cine-space";
      fragment.appendChild(space);
      continue;
    }
    const mask = document.createElement("span");
    mask.className = "cine-char-mask";
    mask.setAttribute("aria-hidden", "true");
    for (const char of Array.from(word)) {
      const inner = document.createElement("span");
      inner.className = "cine-char";
      inner.textContent = char;
      // Asymmetric, prime-hashed stagger: the line reveals as a wave, not a metronome.
      inner.style.setProperty("--char-delay", `${Math.round(index * 26 + jitter(index, 70))}ms`);
      mask.appendChild(inner);
      index += 1;
    }
    fragment.appendChild(mask);
  }

  node.textContent = "";
  node.appendChild(fragment);

  return () => {
    node.textContent = text;
    node.removeAttribute("aria-label");
    delete node.dataset.split;
  };
}

function splitWords(node: HTMLElement): Cleanup {
  if (node.dataset.split === "1") return () => undefined;
  const text = node.textContent ?? "";
  if (!text.trim()) return () => undefined;
  node.dataset.split = "1";
  node.setAttribute("aria-label", text);
  const fragment = document.createDocumentFragment();
  const words = text.split(/\s+/).filter(Boolean);

  words.forEach((word, index) => {
    const mask = document.createElement("span");
    mask.className = "cine-word";
    mask.setAttribute("aria-hidden", "true");
    const inner = document.createElement("span");
    inner.className = "cine-word-inner";
    inner.textContent = word;
    inner.style.setProperty("--char-delay", `${Math.round(index * 48 + jitter(index, 80))}ms`);
    mask.appendChild(inner);
    fragment.appendChild(mask);
    if (index < words.length - 1) {
      const space = document.createElement("span");
      space.className = "cine-space";
      fragment.appendChild(space);
    }
  });

  node.textContent = "";
  node.appendChild(fragment);

  return () => {
    node.textContent = text;
    node.removeAttribute("aria-label");
    delete node.dataset.split;
  };
}

/* ------------------------------------------------------------ interactions */

function attachMagnet(node: HTMLElement): Cleanup {
  const spring = makeSpring(node, () => {
    node.style.setProperty("--magnet-x", `${spring.x.toFixed(2)}px`);
    node.style.setProperty("--magnet-y", `${spring.y.toFixed(2)}px`);
  });

  const move = (event: PointerEvent): void => {
    if (!event.isPrimary || event.pointerType !== "mouse") return;
    const rect = node.getBoundingClientRect();
    const strength = Math.min(7, rect.width * 0.045);
    spring.tx = ((event.clientX - rect.left) / rect.width - 0.5) * strength * 2;
    spring.ty = ((event.clientY - rect.top) / rect.height - 0.5) * strength * 2;
    ensureLoop();
  };
  const leave = (): void => {
    spring.tx = 0;
    spring.ty = 0;
    ensureLoop();
  };

  node.addEventListener("pointermove", move, { passive: true });
  node.addEventListener("pointerleave", leave);
  return () => {
    node.removeEventListener("pointermove", move);
    node.removeEventListener("pointerleave", leave);
    springs.delete(spring);
    node.style.removeProperty("--magnet-x");
    node.style.removeProperty("--magnet-y");
  };
}

/**
 * Pointer sheen. No spring: the gradient should track the cursor exactly, and a
 * lagging highlight reads as a bug rather than as inertia.
 */
function attachSpot(node: HTMLElement): Cleanup {
  const move = (event: PointerEvent): void => {
    if (!event.isPrimary) return;
    const rect = node.getBoundingClientRect();
    node.style.setProperty("--spot-x", `${((event.clientX - rect.left) / rect.width) * 100}%`);
    node.style.setProperty("--spot-y", `${((event.clientY - rect.top) / rect.height) * 100}%`);
  };
  node.addEventListener("pointermove", move, { passive: true });
  return () => node.removeEventListener("pointermove", move);
}

/* ---------------------------------------------------------------- reveals */

const viewportHeight = (): number =>
  window.innerHeight || document.documentElement.clientHeight || 1;

/**
 * Reveal every armed node whose border box has entered the viewport. Reading the
 * border box (not the painted area) is what makes this immune to the clip-path
 * problem described at the top of the file.
 */
function checkReveals(): void {
  if (pendingReveals.size === 0) return;
  const limit = viewportHeight() * 0.94;
  for (const node of pendingReveals) {
    const rect = node.getBoundingClientRect();
    if (rect.top > limit || rect.bottom < 0) continue;
    node.classList.add("is-in");
    pendingReveals.delete(node);
  }
}

/* -------------------------------------------------------------- scroll loop */

function updateScrub(): void {
  const viewport = viewportHeight();
  for (const node of scrubItems) {
    const rect = node.getBoundingClientRect();
    if (rect.bottom < -200 || rect.top > viewport + 200) continue;
    // −1 entering the viewport, +1 leaving it.
    const progress = ((rect.top + rect.height / 2) / viewport - 0.5) * -2;
    if (node.dataset.scrub === "orbit") {
      node.style.setProperty("--scrub-rotate", `${(progress * 26).toFixed(2)}deg`);
    } else {
      const speed = Number.parseFloat(node.dataset.scrub ?? "0") || 0;
      node.style.setProperty("--scrub-y", `${(progress * speed * 70).toFixed(2)}px`);
      const scale = node.dataset.scrubScale;
      if (scale) node.style.setProperty("--scrub-scale", String(1 + progress * Number(scale)));
    }
  }
}

function loop(): void {
  frame = 0;
  if (document.visibilityState === "hidden") {
    running = false;
    return;
  }
  updateScrub();
  checkReveals();
  let moving = false;
  for (const spring of springs) {
    if (spring.step()) moving = true;
  }
  if (moving || scrubItems.size > 0 || pendingReveals.size > 0) {
    frame = requestAnimationFrame(loop);
  } else {
    running = false;
  }
}

function ensureLoop(): void {
  if (running || typeof requestAnimationFrame === "undefined") return;
  running = true;
  if (!frame) frame = requestAnimationFrame(loop);
}

/* ------------------------------------------------------------------ arming */

function arm(node: HTMLElement): void {
  if (node.dataset.animArmed === "1") return;
  node.dataset.animArmed = "1";

  const kind = node.dataset.anim;
  if (kind === "chars") cleanups.add(splitChars(node));
  else if (kind === "words") cleanups.add(splitWords(node));

  // Stagger within a row: the order is the choreography.
  const rect = node.getBoundingClientRect();
  let index = 0;
  for (const sibling of document.querySelectorAll<HTMLElement>("[data-anim]")) {
    if (sibling === node) break;
    if (Math.abs(sibling.getBoundingClientRect().top - rect.top) < 48) index += 1;
  }
  node.style.setProperty("--anim-delay", `${Math.min(index * 80, 400)}ms`);

  pendingReveals.add(node);
  cleanups.add(() => pendingReveals.delete(node));
}

function armAll(): void {
  for (const node of document.querySelectorAll<HTMLElement>("[data-anim]")) arm(node);

  for (const node of document.querySelectorAll<HTMLElement>("[data-magnet]")) {
    if (node.dataset.magnetArmed === "1") continue;
    node.dataset.magnetArmed = "1";
    cleanups.add(attachMagnet(node));
  }

  for (const node of document.querySelectorAll<HTMLElement>("[data-spot]")) {
    if (node.dataset.spotArmed === "1") continue;
    node.dataset.spotArmed = "1";
    cleanups.add(attachSpot(node));
  }

  for (const node of document.querySelectorAll<HTMLElement>("[data-scrub]")) {
    if (node.dataset.scrubArmed === "1") continue;
    node.dataset.scrubArmed = "1";
    scrubItems.add(node);
    cleanups.add(() => scrubItems.delete(node));
  }

  if (scrubItems.size > 0) updateScrub();
  checkReveals();
  if (pendingReveals.size > 0 || scrubItems.size > 0) ensureLoop();
}

let scheduled = 0;
function scheduleArm(): void {
  if (scheduled) return;
  scheduled = window.setTimeout(() => {
    scheduled = 0;
    armAll();
  }, 70);
}

/** Mount the engine for the current route. Re-entrant and idempotent per node. */
export function initCinema(): void {
  const root = document.documentElement;
  if (prefersReducedMotion()) {
    root.classList.remove("cine-ready");
    for (const node of document.querySelectorAll<HTMLElement>("[data-anim]")) {
      node.classList.add("is-in");
    }
    return;
  }

  armAll();

  // The hidden states only make sense once the first arm pass has run.
  root.classList.add("cine-ready");

  if (!mutation) {
    mutation = new MutationObserver(scheduleArm);
    mutation.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);

  if (sweep) window.clearTimeout(sweep);
  sweep = window.setTimeout(() => {
    sweep = 0;
    // Last resort: nothing in view may stay masked forever.
    for (const node of document.querySelectorAll<HTMLElement>("[data-anim]:not(.is-in)")) {
      const { top, bottom } = node.getBoundingClientRect();
      if (top < viewportHeight() && bottom > 0) node.classList.add("is-in");
    }
  }, SWEEP_MS);
}

function onScroll(): void {
  ensureLoop();
}

function onVisibility(): void {
  if (document.visibilityState === "visible") ensureLoop();
}

/** Detach everything armed for the current route. */
export function teardownCinema(): void {
  if (sweep) {
    window.clearTimeout(sweep);
    sweep = 0;
  }
  if (scheduled) {
    window.clearTimeout(scheduled);
    scheduled = 0;
  }
  if (frame) {
    cancelAnimationFrame(frame);
    frame = 0;
  }
  running = false;
  mutation?.disconnect();
  mutation = null;

  for (const undo of cleanups) undo();
  cleanups.clear();
  scrubItems.clear();
  springs.clear();
  pendingReveals.clear();

  /* Clear the armed flags too. Under StrictMode the effect runs twice on the SAME
     DOM nodes: without this, the second pass would consider every node already
     armed, attach nothing, and the hidden states would wait for the 3 s sweep. */
  for (const node of document.querySelectorAll<HTMLElement>(
    "[data-anim], [data-magnet], [data-spot], [data-scrub]"
  )) {
    delete node.dataset.animArmed;
    delete node.dataset.magnetArmed;
    delete node.dataset.spotArmed;
    delete node.dataset.scrubArmed;
  }

  window.removeEventListener("scroll", onScroll);
  window.removeEventListener("resize", onScroll);
  document.removeEventListener("visibilitychange", onVisibility);
  document.documentElement.classList.remove("cine-ready");
}
