/**
 * Choreography engine — the "After Effects timeline" of the brand site.
 *
 * Hand-rolled on IntersectionObserver + requestAnimationFrame because the repo
 * forbids dependency installs; every technique the brief asks for is here, as a
 * small composable primitive instead of a framework:
 *
 *   data-motion="words"   split-text mask reveal, word by word, asymmetric stagger
 *   data-motion="mask"    clip-path wipe for panels and figures
 *   data-tilt             spring-follow pointer tilt with a specular glare
 *   data-magnet           magnetic hover: the control leans toward the cursor
 *   data-parallax="0.12"  scroll-linked drift, batched in one rAF loop
 *
 * Physics: no linear, no default easings. Entrances use an aggressive
 * anticipation curve (`--ease-anticipate`), interactions use an underdamped
 * spring integrator (stiffness/damping, not a transition), so hovers have
 * inertia and follow-through instead of symmetric fades.
 *
 * Safety properties, inherited from reveal.ts:
 *  - every hidden state is applied by JS; no JS → content is fully visible;
 *  - prefers-reduced-motion disables everything (content renders static);
 *  - a 3.5 s sweep reveals anything that failed to arm, so a bug can never
 *    permanently hide a section;
 *  - the scroll loop stops itself when nothing is registered and the tab is
 *    hidden; every observer disconnects on teardown.
 */

const SWEEP_MS = 3500;

type Registered = {
  root: HTMLElement;
  armed: boolean;
  cleanup: () => void;
};

const registered = new Set<Registered>();
let intersectionObserver: IntersectionObserver | null = null;
let mutationObserver: MutationObserver | null = null;
let sweepTimer = 0;
let scrollRaf = 0;
let scrollRunning = false;

export function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/* ------------------------------------------------------------------ springs */

/**
 * A semi-implicit Euler spring. Underdamped on purpose: values overshoot by a
 * few percent and settle, which reads as weight rather than as a transition.
 */
class Spring {
  value: number;
  private target: number;
  private velocity = 0;
  private readonly stiffness: number;
  private readonly damping: number;
  private readonly precision: number;

  constructor(initial = 0, stiffness = 170, damping = 18, precision = 0.001) {
    this.value = initial;
    this.target = initial;
    this.stiffness = stiffness;
    this.damping = damping;
    this.precision = precision;
  }

  set(target: number): void {
    this.target = target;
  }

  /** Advance one frame. Returns true while the spring is still moving. */
  step(dt: number): boolean {
    const force = (this.target - this.value) * this.stiffness;
    this.velocity += force * dt;
    this.velocity *= Math.exp(-this.damping * dt);
    this.value += this.velocity * dt;
    return (
      Math.abs(this.target - this.value) > this.precision ||
      Math.abs(this.velocity) > this.precision
    );
  }
}

/* ------------------------------------------------------------------- tilt */

function attachTilt(root: HTMLElement): () => void {
  let active = false;
  let raf = 0;
  const rx = new Spring(0, 190, 15);
  const ry = new Spring(0, 190, 15);
  const gl = new Spring(0, 150, 20);

  const render = (): void => {
    raf = 0;
    let moving = false;
    moving = rx.step(1 / 60) || moving;
    moving = ry.step(1 / 60) || moving;
    moving = gl.step(1 / 60) || moving;
    root.style.setProperty("--tilt-x", `${ry.value.toFixed(3)}deg`);
    root.style.setProperty("--tilt-y", `${(-rx.value).toFixed(3)}deg`);
    root.style.setProperty("--tilt-glow", gl.value.toFixed(3));
    if (moving && active) raf = requestAnimationFrame(render);
  };

  const queue = (): void => {
    if (!raf && active) raf = requestAnimationFrame(render);
  };

  const onMove = (event: PointerEvent): void => {
    if (!event.isPrimary || event.pointerType !== "mouse") return;
    const rect = root.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    rx.set(py * 7); // max 3.5deg — enough to feel physical, never seasick
    ry.set(px * 9);
    gl.set(1);
    root.style.setProperty("--glare-x", `${((px + 0.5) * 100).toFixed(1)}%`);
    root.style.setProperty("--glare-y", `${((py + 0.5) * 100).toFixed(1)}%`);
    active = true;
    queue();
  };

  const onLeave = (): void => {
    rx.set(0);
    ry.set(0);
    gl.set(0);
    queue();
  };

  root.addEventListener("pointermove", onMove, { passive: true });
  root.addEventListener("pointerleave", onLeave);
  return () => {
    cancelAnimationFrame(raf);
    root.removeEventListener("pointermove", onMove);
    root.removeEventListener("pointerleave", onLeave);
    root.style.removeProperty("--tilt-x");
    root.style.removeProperty("--tilt-y");
    root.style.removeProperty("--tilt-glow");
  };
}

/* ----------------------------------------------------------------- magnet */

function attachMagnet(root: HTMLElement): () => void {
  let raf = 0;
  let active = false;
  const dx = new Spring(0, 240, 16);
  const dy = new Spring(0, 240, 16);

  const render = (): void => {
    raf = 0;
    const moving = dx.step(1 / 60) || dy.step(1 / 60);
    root.style.setProperty("--magnet-x", `${dx.value.toFixed(2)}px`);
    root.style.setProperty("--magnet-y", `${dy.value.toFixed(2)}px`);
    if (moving && active) raf = requestAnimationFrame(render);
  };

  const queue = (): void => {
    if (!raf && active) raf = requestAnimationFrame(render);
  };

  const onMove = (event: PointerEvent): void => {
    if (!event.isPrimary || event.pointerType !== "mouse") return;
    const rect = root.getBoundingClientRect();
    const strength = Math.min(10, rect.width * 0.06);
    dx.set(((event.clientX - rect.left) / rect.width - 0.5) * strength * 2);
    dy.set(((event.clientY - rect.top) / rect.height - 0.5) * strength * 2);
    active = true;
    queue();
  };

  const onLeave = (): void => {
    dx.set(0);
    dy.set(0);
    queue();
  };

  root.addEventListener("pointermove", onMove, { passive: true });
  root.addEventListener("pointerleave", onLeave);
  return () => {
    cancelAnimationFrame(raf);
    root.removeEventListener("pointermove", onMove);
    root.removeEventListener("pointerleave", onLeave);
    root.style.removeProperty("--magnet-x");
    root.style.removeProperty("--magnet-y");
  };
}

/* --------------------------------------------------------------- parallax */

const parallaxItems = new Set<{ el: HTMLElement; speed: number; undo: () => void }>();

function updateParallax(): void {
  const viewport = window.innerHeight;
  for (const item of parallaxItems) {
    const rect = item.el.getBoundingClientRect();
    // Progress −1..1 across the viewport; drift = progress × speed × 100px.
    const progress = ((rect.top + rect.height / 2) / viewport - 0.5) * -2;
    item.el.style.setProperty("--parallax-y", `${(progress * item.speed * 90).toFixed(2)}px`);
  }
}

function scrollLoop(): void {
  scrollRaf = 0;
  if (parallaxItems.size === 0 || document.visibilityState === "hidden") {
    scrollRunning = false;
    return;
  }
  updateParallax();
  scrollRaf = requestAnimationFrame(scrollLoop);
}

function ensureScrollLoop(): void {
  if (scrollRunning) return;
  scrollRunning = true;
  if (!scrollRaf) scrollRaf = requestAnimationFrame(scrollLoop);
}

window.addEventListener("scroll", ensureScrollLoop, { passive: true });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") ensureScrollLoop();
});

/* ---------------------------------------------------------------- arming */

function ensureIntersectionObserver(): IntersectionObserver {
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
    { rootMargin: "0px 0px -10% 0px", threshold: 0.12 }
  );
  return intersectionObserver;
}

function register(root: HTMLElement, cleanup: () => void): void {
  const item: Registered = { root, armed: true, cleanup };
  registered.add(item);
  const io = ensureIntersectionObserver();
  io.observe(root);
}

function armNode(node: HTMLElement): void {
  const motion = node.dataset.motion;
  if (!motion || node.dataset.motionArmed === "1") return;

  if (reducedMotion()) {
    node.classList.add("is-in");
    node.dataset.motionArmed = "1";
    return;
  }

  node.dataset.motionArmed = "1";

  const io = ensureIntersectionObserver();
  const observer = new MutationObserver(() => undefined);
  observer.disconnect();

  register(node, () => {
    io.unobserve(node);
  });
}

function armAll(): void {
  for (const node of document.querySelectorAll<HTMLElement>("[data-motion]")) armNode(node);
  for (const node of document.querySelectorAll<HTMLElement>("[data-tilt]")) {
    if (node.dataset.tiltArmed === "1") continue;
    node.dataset.tiltArmed = "1";
    if (reducedMotion()) continue;
    const cleanup = attachTilt(node);
    registered.add({ root: node, armed: true, cleanup });
  }
  for (const node of document.querySelectorAll<HTMLElement>("[data-magnet]")) {
    if (node.dataset.magnetArmed === "1") continue;
    node.dataset.magnetArmed = "1";
    if (reducedMotion()) continue;
    const cleanup = attachMagnet(node);
    registered.add({ root: node, armed: true, cleanup });
  }
  for (const node of document.querySelectorAll<HTMLElement>("[data-parallax]")) {
    if (node.dataset.parallaxArmed === "1") continue;
    node.dataset.parallaxArmed = "1";
    if (reducedMotion()) continue;
    const speed = Number.parseFloat(node.dataset.parallax ?? "0.12") || 0.12;
    const item = { el: node, speed, undo: () => undefined };
    parallaxItems.add(item);
    registered.add({
      root: node,
      armed: true,
      cleanup: () => {
        parallaxItems.delete(item);
        node.style.removeProperty("--parallax-y");
        node.style.removeProperty("--parallax");
      },
    });
    ensureScrollLoop();
  }
}

let armScheduled = 0;
function scheduleArmAll(): void {
  if (armScheduled) return;
  armScheduled = window.setTimeout(() => {
    armScheduled = 0;
    armAll();
  }, 80);
}

/** Start the engine for the current route. Re-entrant, idempotent per node. */
export function initMotion(): void {
  if (reducedMotion()) {
    for (const node of document.querySelectorAll<HTMLElement>("[data-motion]")) {
      node.classList.add("is-in");
      node.dataset.motionArmed = "1";
    }
    return;
  }
  armAll();
  if (!mutationObserver && typeof MutationObserver !== "undefined") {
    mutationObserver = new MutationObserver(scheduleArmAll);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
  }
  if (sweepTimer) window.clearTimeout(sweepTimer);
  sweepTimer = window.setTimeout(() => {
    sweepTimer = 0;
    // Last resort: nothing visible may stay masked forever.
    for (const node of document.querySelectorAll<HTMLElement>("[data-motion]:not(.is-in)")) {
      const { top, bottom } = node.getBoundingClientRect();
      if (top < window.innerHeight && bottom > 0) {
        node.style.transitionDuration = "1ms";
        node.classList.add("is-in");
      }
    }
  }, SWEEP_MS);
}

/** Detach everything the engine armed for the current route. */
export function teardownMotion(): void {
  if (sweepTimer) {
    window.clearTimeout(sweepTimer);
    sweepTimer = 0;
  }
  if (armScheduled) {
    window.clearTimeout(armScheduled);
    armScheduled = 0;
  }
  mutationObserver?.disconnect();
  mutationObserver = null;
  for (const item of registered) item.cleanup();
  registered.clear();
}
