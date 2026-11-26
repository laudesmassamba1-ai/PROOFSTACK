/*
 * Adapted from "Stack" by React Bits (https://reactbits.dev), MIT licence.
 * Changes for this codebase: named export, TypeScript types, timers as
 * ReturnType<typeof setTimeout>, class names prefixed `card-stack-` (the source
 * `.stack` is too generic to trust in a 10k-line stylesheet), an `ariaLabel`
 * prop instead of a hardcoded English string, and biome-ignores where the lint
 * disagrees with the source's intent (documented inline). Physics, springs and
 * behaviour are the source's own.
 */

import type { MotionValue, Transition } from "motion/react";
import { animate, motion, motionValue, useReducedMotion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./CardStack.css";

export type StackLayout = "fan" | "cascade" | "deck" | "pile";

export interface StackProps {
  /** The cards in the stack, top first. */
  cards?: ReactNode[];
  /** How the cards behind sit. */
  layout?: StackLayout;
  /** How many cards show, counting the top one. */
  visible?: number;
  /** How far the cards behind fan, offset or scatter, from 0 to 1. */
  spread?: number;
  /** How much smaller and darker each card behind gets, from 0 to 1. */
  depth?: number;
  /** Corner radius of the cards in pixels. */
  radius?: number;
  /** Width of a border around each card in pixels. */
  frame?: number;
  frameColor?: string;
  shadow?: boolean;
  /** How far the top card leans in 3D while it is dragged, in degrees. */
  tilt?: number;
  /** How far in pixels the top card must be dragged before it goes to the back. */
  threshold?: number;
  /** Speed of every animation, from 0.5 for slow to 2 for fast. */
  speed?: number;
  /** Clicking the top card also sends it to the back. */
  sendToBackOnClick?: boolean;
  /** Clicking the pile spreads every card out, clickable; the top card or
   * outside click folds them back. The pile becomes a hand, not a cycle. */
  expandable?: boolean;
  onOpenChange?: (open: boolean) => void;
  autoplay?: boolean;
  autoplayDelay?: number;
  pauseOnHover?: boolean;
  onChange?: (index: number) => void;
  /** Accessible name of the stack; the source hardcodes English. */
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
}

const ORIGINS: Record<StackLayout, [number, number]> = {
  fan: [0.9, 0.9],
  cascade: [0.5, 0.5],
  deck: [0.5, 0],
  pile: [0.5, 0.5],
};
const EXITS: Partial<Record<StackLayout, [number, number]>> = {
  fan: [1, -0.3],
  cascade: [0.8, 0.6],
  deck: [0, 1],
};
const SHADOW = "0 14px 34px -10px rgba(0, 0, 0, 0.45), 0 3px 8px -2px rgba(0, 0, 0, 0.18)";
const CLICK_SLOP = 6;
const FLICK_SPEED = 650;
const LEAN_SPEED = 1300;
const LEAN_REACH = 260;
const PRESS_SCALE = 1.035;
const SPRINGS: Record<
  "place" | "settle" | "tuck" | "face" | "lean" | "press" | "fling",
  [number, number]
> = {
  place: [260, 24],
  settle: [320, 34],
  tuck: [240, 28],
  face: [240, 30],
  lean: [240, 28],
  press: [420, 34],
  fling: [650, 42],
};

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

const noise = (seed: number): number => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

interface Placement {
  x: number;
  y: number;
  rotate: number;
  scale: number;
}

const placement = (
  layout: StackLayout,
  position: number,
  card: number,
  spread: number,
  depth: number
): Placement => {
  if (layout === "cascade") {
    return {
      x: -position * spread * 28,
      y: -position * spread * 28,
      rotate: 0,
      scale: 1 - position * depth * 0.07,
    };
  }
  if (layout === "deck") {
    return { x: 0, y: -position * spread * 32, rotate: 0, scale: 1 - position * depth * 0.1 };
  }
  if (layout === "pile") {
    return {
      x: (noise(card + 1) - 0.5) * spread * 56,
      y: (noise(card + 2) - 0.5) * spread * 44,
      rotate: (noise(card + 3) - 0.5) * spread * 40,
      scale: 1 - position * depth * 0.03,
    };
  }
  return { x: 0, y: 0, rotate: position * spread * 8, scale: 1 - position * depth * 0.12 };
};

const releaseVelocity = (samples: [number, number, number][], time: number): [number, number] => {
  const recent = samples.filter((sample) => time - sample[2] <= 100);
  if (recent.length < 2) return [0, 0];
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (!first || !last) return [0, 0];
  const elapsed = Math.max((last[2] - first[2]) / 1000, 0.008);
  return [(last[0] - first[0]) / elapsed, (last[1] - first[1]) / elapsed];
};

interface PlaceAllOptions {
  stagger?: number;
  lift?: number;
  released?: number;
  velocity?: [number, number] | null;
  kind?: "place" | "settle" | "tuck";
}

interface StackActions {
  placeAll: (options?: PlaceAllOptions) => void;
  sendToBack: (direction: [number, number] | null, velocity?: [number, number] | null) => void;
  onMove: (event: PointerEvent) => void;
  onUp: (event: PointerEvent) => void;
}

interface CardValues {
  x: MotionValue<number>;
  y: MotionValue<number>;
  rotate: MotionValue<number>;
  scale: MotionValue<number>;
  tiltX: MotionValue<number>;
  tiltY: MotionValue<number>;
  spin: MotionValue<number>;
  lift: MotionValue<number>;
  grabX: MotionValue<number>;
  grabY: MotionValue<number>;
  z: MotionValue<number>;
  opacity: MotionValue<number>;
  shade: MotionValue<number>;
}

interface DragState {
  card: number;
  id: number;
  element: HTMLDivElement;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  homeX: number;
  homeY: number;
  vx: number;
  vy: number;
  idle: ReturnType<typeof setTimeout>;
  moved: boolean;
  progress: number;
  samples: [number, number, number][];
}

export function Stack({
  cards,
  layout = "fan",
  visible = 4,
  spread = 0.5,
  depth = 0.5,
  radius = 16,
  frame = 0,
  frameColor = "#ffffff",
  shadow = true,
  tilt = 30,
  threshold = 90,
  speed = 1,
  sendToBackOnClick = false,
  expandable = false,
  onOpenChange,
  autoplay = false,
  autoplayDelay = 3000,
  pauseOnHover = false,
  onChange,
  ariaLabel = "Card stack",
  className = "",
  style,
}: StackProps) {
  const count = cards?.length ?? 0;
  const shape: StackLayout = ORIGINS[layout] ? layout : "fan";
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [order, setOrder] = useState<number[]>(() =>
    Array.from({ length: count }, (_, index) => index)
  );
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const orderRef = useRef<number[]>(order);
  const valuesRef = useRef(new Map<number, CardValues>());
  const elementsRef = useRef(new Map<number, HTMLDivElement | null>());
  const flyingRef = useRef(new Map<number, { turned: boolean }>());
  const dragRef = useRef<DragState | null>(null);
  const aliveRef = useRef(true);
  const mountedRef = useRef(false);
  const settingsRef = useRef<{
    layout: StackLayout;
    visible: number;
    spread: number;
    depth: number;
    tilt: number;
    threshold: number;
    speed: number;
    sendToBackOnClick: boolean;
    expandable: boolean;
    count: number;
    reduceMotion: boolean;
  }>(null as never);
  const actionsRef = useRef<StackActions>(null as never);
  const listenersRef = useRef<{
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
  }>(null as never);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  if (order.length !== count || order.some((index) => index >= count)) {
    const next = order.filter((index) => index < count);
    for (let index = 0; index < count; index++) if (!next.includes(index)) next.push(index);
    orderRef.current = next;
    setOrder(next);
  }

  settingsRef.current = {
    layout: shape,
    visible: clamp(Math.round(visible), 1, Math.max(count, 1)),
    spread: clamp(spread, 0, 2),
    depth: clamp(depth, 0, 1),
    tilt: clamp(tilt, 0, 89),
    threshold: Math.max(threshold, 0),
    speed: clamp(speed, 0.2, 4),
    sendToBackOnClick,
    expandable,
    count,
    reduceMotion: !!reduceMotion,
  };

  const valuesFor = (index: number): CardValues => {
    let values = valuesRef.current.get(index);
    if (!values) {
      const s = settingsRef.current;
      const position = Math.max(0, orderRef.current.indexOf(index));
      const start = placement(
        s.layout,
        s.reduceMotion ? Math.min(position, s.visible - 1) : 0,
        index,
        s.spread,
        s.depth
      );
      values = {
        x: motionValue(start.x),
        y: motionValue(start.y),
        rotate: motionValue(start.rotate),
        scale: motionValue(start.scale),
        tiltX: motionValue(0),
        tiltY: motionValue(0),
        spin: motionValue(0),
        lift: motionValue(1),
        grabX: motionValue(0.5),
        grabY: motionValue(0.5),
        z: motionValue(s.count - position),
        opacity: motionValue(position < s.visible ? 1 : 0),
        shade: motionValue(0),
      };
      valuesRef.current.set(index, values);
    }
    return values;
  };

  const springFor = (
    s: typeof settingsRef.current,
    kind: keyof typeof SPRINGS,
    extra: Transition = {}
  ): Transition => {
    if (s.reduceMotion)
      return { duration: 0.2, ease: "easeOut", delay: (extra.delay as number) || 0 };
    const spring = SPRINGS[kind];
    const stiffness = spring[0];
    const damping = spring[1];
    return {
      type: "spring",
      stiffness: stiffness * s.speed * s.speed,
      damping: damping * s.speed,
      restDelta: 0.01,
      restSpeed: 0.5,
      ...extra,
    };
  };

  const settleFace = (values: CardValues, s: typeof settingsRef.current, delay = 0) => {
    const transition = springFor(s, "face", { delay });
    animate(values.tiltX, 0, transition);
    animate(values.tiltY, 0, transition);
    animate(values.spin, 0, transition);
    animate(values.lift, 1, transition);
  };

  const placeCard = (
    index: number,
    position: number,
    {
      delay = 0,
      lift = 0,
      kind = "place",
      velocity = null,
      keepZ = false,
    }: {
      delay?: number;
      lift?: number;
      kind?: "place" | "settle" | "tuck";
      velocity?: [number, number] | null;
      keepZ?: boolean;
    } = {}
  ) => {
    const s = settingsRef.current;
    const values = valuesFor(index);
    const shown = Math.min(position, s.visible - 1);
    const target = placement(s.layout, shown, index, s.spread, s.depth);
    if (lift > 0 && shown > 0) {
      const ahead = placement(s.layout, shown - 1, index, s.spread, s.depth);
      target.x = mix(target.x, ahead.x, lift);
      target.y = mix(target.y, ahead.y, lift);
      target.rotate = mix(target.rotate, ahead.rotate, lift);
      target.scale = mix(target.scale, ahead.scale, lift);
    }
    const motionSpring = springFor(s, kind, { delay });
    const fade: Transition = {
      duration: s.reduceMotion ? 0.2 : 0.35 / s.speed,
      ease: "easeOut",
      delay,
    };
    if (!keepZ) values.z.set(s.count - position);
    animate(
      values.x,
      target.x,
      velocity ? { ...motionSpring, velocity: velocity[0] } : motionSpring
    );
    animate(
      values.y,
      target.y,
      velocity ? { ...motionSpring, velocity: velocity[1] } : motionSpring
    );
    animate(values.rotate, target.rotate, motionSpring);
    animate(values.scale, target.scale, motionSpring);
    settleFace(values, s, delay);
    animate(values.opacity, position < s.visible ? 1 : 0, fade);
    animate(values.shade, Math.min(0.6, shown * s.depth * 0.14 * (1 - lift)), fade);
  };

  const placeAll = ({
    stagger = 0,
    lift = 0,
    released = -1,
    velocity = null,
    kind = "place",
  }: PlaceAllOptions = {}) => {
    const drag = dragRef.current;
    orderRef.current.forEach((index, position) => {
      const flight = flyingRef.current.get(index);
      if (flight && !flight.turned) return;
      if (drag?.moved && drag.card === index) return;
      const isReleased = index === released;
      placeCard(index, position, {
        delay: position * stagger,
        lift: position > 0 ? lift : 0,
        kind: flight ? "tuck" : isReleased ? "settle" : kind,
        velocity: isReleased ? velocity : null,
        keepZ: !!flight,
      });
    });
  };

  const commit = (next: number[]) => {
    orderRef.current = next;
    setOrder(next);
  };

  const sendToBack = (
    direction: [number, number] | null,
    velocity: [number, number] | null = null
  ) => {
    const s = settingsRef.current;
    const current = orderRef.current;
    if (current.length < 2) return;
    const top = current[0];
    if (top === undefined) return;
    if (flyingRef.current.has(top)) return;
    const next = [...current.slice(1), top];
    if (s.reduceMotion) {
      commit(next);
      return;
    }
    let [dx, dy] = direction ??
      EXITS[s.layout] ?? [Math.cos(noise(top + 9) * 6.283), Math.sin(noise(top + 9) * 6.283)];
    const length = Math.hypot(dx, dy) || 1;
    dx /= length;
    dy /= length;
    const bounds = rootRef.current?.getBoundingClientRect();
    const width = bounds?.width || 240;
    const height = bounds?.height || 240;
    const clearance = Math.min(
      width / Math.max(Math.abs(dx), 0.01),
      height / Math.max(Math.abs(dy), 0.01)
    );
    const home = placement(s.layout, 0, top, s.spread, s.depth);
    const travel = clearance * 1.12 + 40;
    const out: [number, number] = [home.x + dx * travel, home.y + dy * travel];
    const values = valuesFor(top);
    const launch = springFor(s, "fling");
    const flight = { turned: false };
    flyingRef.current.set(top, flight);
    values.z.set(s.count + 1);
    animate(values.x, out[0], velocity ? { ...launch, velocity: velocity[0] } : launch);
    animate(values.y, out[1], velocity ? { ...launch, velocity: velocity[1] } : launch);
    settleFace(values, s);
    commit(next);
    const span = Math.max(Math.hypot(out[0] - values.x.get(), out[1] - values.y.get()), 1);
    let landed = false;
    const turn = () => {
      flight.turned = true;
      const position = orderRef.current.indexOf(top);
      if (position >= 0) placeCard(top, position, { kind: "tuck", keepZ: !landed });
    };
    const land = () => {
      landed = true;
      if (flyingRef.current.get(top) === flight) flyingRef.current.delete(top);
      const position = orderRef.current.indexOf(top);
      if (position >= 0) values.z.set(settingsRef.current.count - position);
    };
    const fallback = setTimeout(() => {
      if (!flight.turned) turn();
      if (!landed) land();
    }, 1500 / s.speed);
    const clearOfPile = () => {
      const element = elementsRef.current.get(top);
      if (!element) return true;
      const mine = element.getBoundingClientRect();
      for (const [index, other] of elementsRef.current) {
        if (!other) continue;
        if (index === top || flyingRef.current.has(index) || valuesFor(index).opacity.get() < 0.5)
          continue;
        const box = other.getBoundingClientRect();
        if (
          mine.left < box.right &&
          mine.right > box.left &&
          mine.top < box.bottom &&
          mine.bottom > box.top
        ) {
          return false;
        }
      }
      return true;
    };
    const watch = () => {
      if (!aliveRef.current || (flight.turned && landed)) {
        clearTimeout(fallback);
        return;
      }
      const x = values.x.get();
      const y = values.y.get();
      const outward = values.x.getVelocity() * dx + values.y.getVelocity() * dy;
      if (!flight.turned && (Math.hypot(out[0] - x, out[1] - y) <= span * 0.06 || outward < 0))
        turn();
      if (!landed && (clearOfPile() || (flight.turned && outward < 0))) land();
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  };

  const lean = (drag: DragState) => {
    const s = settingsRef.current;
    if (s.reduceMotion) return;
    const values = valuesFor(drag.card);
    const offsetX = values.x.get() - drag.homeX;
    const offsetY = values.y.get() - drag.homeY;
    const sideways =
      clamp(drag.vx / LEAN_SPEED, -1, 1) * 0.7 + clamp(offsetX / LEAN_REACH, -1, 1) * 0.3;
    const upward =
      clamp(-drag.vy / LEAN_SPEED, -1, 1) * 0.7 + clamp(-offsetY / LEAN_REACH, -1, 1) * 0.3;
    const follow = springFor(s, "lean");
    animate(values.tiltY, sideways * s.tilt, follow);
    animate(values.tiltX, upward * s.tilt, follow);
    animate(values.spin, clamp(offsetX / LEAN_REACH, -1, 1) * 6, follow);
  };

  // ---- the spread: clicking an expandable pile deals every card out so each
  // ---- is reachable, then the pile folds back on top card, outside click or
  // ---- Escape. Desktop deals a row across the section; a narrow page deals
  // ---- the cards downward, each showing its lower strip (where the name is).
  // The dealt row shrinks every card so all five stay readable side by side;
  // the fan's bottom-right transform origin shifts a scaled card, so the x/y
  // targets compensate for it (0.9 is the fan origin factor).
  const dealtRow = (
    position: number,
    count: number,
    width: number,
    height: number,
    available: number
  ): { x: number; y: number; rotate: number; scale: number } => {
    const scale = clamp(available / (count * width), 0.4, 1);
    const visual = width * scale;
    const step = Math.min(visual * 0.96, (available - visual) / Math.max(count - 1, 1));
    // The row grows rightward from the root's own left edge: the wrapper sits
    // at the section's left, so nothing ever clips against the page margin.
    const left = 0;
    return {
      x: left + position * step - 0.9 * width * (1 - scale),
      y: (height - height * scale) / 2 - 0.9 * height * (1 - scale),
      rotate: 0,
      scale,
    };
  };

  const applyOpen = (open: boolean) => {
    const s = settingsRef.current;
    if (s.reduceMotion) {
      // No world to animate: jump the cards to their dealt places and back.
      const n = Math.max(s.count, 1);
      const rootNow = rootRef.current;
      const hostNow = rootNow?.parentElement;
      const availableNow = hostNow?.getBoundingClientRect().width ?? 1340;
      orderRef.current.forEach((index, position) => {
        const values = valuesFor(index);
        if (open) {
          const target = dealtRow(
            position,
            n,
            rootNow?.getBoundingClientRect().width ?? 420,
            rootNow?.getBoundingClientRect().height ?? 430,
            availableNow
          );
          values.x.set(target.x);
          values.y.set(target.y);
          values.rotate.set(target.rotate);
          values.scale.set(target.scale);
          values.opacity.set(1);
          values.shade.set(0);
          values.z.set(position + 2);
        } else {
          const target = placement(s.layout, position, index, s.spread, s.depth);
          values.x.set(target.x);
          values.y.set(target.y);
          values.rotate.set(target.rotate);
          values.scale.set(target.scale);
          values.opacity.set(position < s.visible ? 1 : 0);
          values.z.set(s.count - position);
        }
      });
      return;
    }
    const root = rootRef.current;
    if (!root) return;
    const bounds = root.getBoundingClientRect();
    // The root is usually a card-sized wrapper; the dealt row may span the
    // section around it, so walk up to the first ancestor that is clearly
    // wider before measuring the room the hand has to deal into.
    let host = root.parentElement;
    while (
      host &&
      host !== document.body &&
      host.getBoundingClientRect().width < bounds.width * 1.6
    ) {
      host = host.parentElement;
    }
    const available = host?.getBoundingClientRect().width ?? window.innerWidth;
    const narrow = available < 980;
    const step = narrow ? Math.min(150, bounds.height * 0.36) : 0;
    orderRef.current.forEach((index, position) => {
      const values = valuesFor(index);
      if (open) {
        const target = narrow
          ? {
              x: position % 2 ? 9 : -7,
              y: position * step,
              rotate: position % 2 ? 2 : -2,
              scale: 1,
            }
          : dealtRow(position, s.count, bounds.width, bounds.height, available);
        const spring = springFor(s, "settle", { delay: position * 0.045 });
        animate(values.x, target.x, spring);
        animate(values.y, target.y, spring);
        animate(values.rotate, target.rotate, spring);
        animate(values.scale, target.scale, spring);
        animate(values.opacity, 1, { duration: 0.3, ease: "easeOut", delay: position * 0.045 });
        animate(values.shade, 0, { duration: 0.3, ease: "easeOut" });
        // Dealt left-to-right / top-to-bottom, each card above the previous:
        // the left (or lower) strip of every card stays visible and clickable.
        values.z.set(position + 2);
        settleFace(values, s, position * 0.045);
      } else {
        placeCard(index, position, { kind: "settle", delay: position * 0.03 });
      }
    });
  };

  // The mirror must flip before the state commits: the click that follows the
  // pointerup of the same gesture arrives after React has re-rendered, and it
  // must not read the pre-toggle value. The suppressClick stamp kills that
  // trailing click (a link would navigate, or the capture would re-fold).
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const suppressClickRef = useRef(0);
  const toggleOpen = () => {
    const open = !expandedRef.current;
    expandedRef.current = open;
    suppressClickRef.current = performance.now();
    applyOpen(open);
    onOpenChange?.(open);
    setExpanded(open);
  };

  // The pointer handlers run outside React's render; they read this mirror.
  const openRef = useRef({ enabled: false, open: expanded, toggle: toggleOpen });
  openRef.current = { enabled: expandable, open: expanded, toggle: toggleOpen };

  // biome-ignore lint/correctness/useExhaustiveDependencies: toggle reads the openRef mirror
  useEffect(() => {
    if (!expanded) return undefined;
    // The fold listens on the document: focus usually rests on a dealt card's
    // link, not on the root, so neither Escape nor an outside click would be
    // seen by the root's own handlers.
    const close = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && rootRef.current.contains(event.target))
        return;
      toggleOpen();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") toggleOpen();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onEscape);
    };
  }, [expanded]);

  const onMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.id) return;
    const s = settingsRef.current;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const values = valuesFor(drag.card);
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < CLICK_SLOP) return;
      drag.moved = true;
      values.x.stop();
      values.y.stop();
      drag.originX = values.x.get() - dx;
      drag.originY = values.y.get() - dy;
      try {
        drag.element.setPointerCapture(drag.id);
      } catch {
        /* setPointerCapture can throw on synthetic pointers; the drag still works. */
      }
      setDragging(true);
    }
    values.x.set(drag.originX + dx);
    values.y.set(drag.originY + dy);
    drag.samples.push([event.clientX, event.clientY, event.timeStamp]);
    if (drag.samples.length > 12) drag.samples.shift();
    const velocity = releaseVelocity(drag.samples, event.timeStamp);
    drag.vx = velocity[0];
    drag.vy = velocity[1];
    lean(drag);
    clearTimeout(drag.idle);
    drag.idle = setTimeout(() => {
      if (dragRef.current !== drag) return;
      drag.vx = 0;
      drag.vy = 0;
      lean(drag);
    }, 70);
    const progress = clamp(Math.hypot(dx, dy) / Math.max(s.threshold, 1), 0, 1);
    if (Math.abs(progress - drag.progress) > 0.02) {
      drag.progress = progress;
      placeAll({ lift: progress * 0.4, kind: "settle" });
    }
  };

  const onUp = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.id) return;
    dragRef.current = null;
    clearTimeout(drag.idle);
    window.removeEventListener("pointermove", listenersRef.current.move);
    window.removeEventListener("pointerup", listenersRef.current.up);
    window.removeEventListener("pointercancel", listenersRef.current.up);
    try {
      drag.element.releasePointerCapture(drag.id);
    } catch {
      /* the capture may already be gone; nothing to undo. */
    }
    const s = settingsRef.current;
    if (!drag.moved) {
      if (event.type === "pointerup" && s.sendToBackOnClick) sendToBack(null);
      else if (event.type === "pointerup" && s.expandable) openRef.current.toggle();
      else settleFace(valuesFor(drag.card), s);
      return;
    }
    setDragging(false);
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const velocity = releaseVelocity(drag.samples, event.timeStamp);
    const distance = Math.hypot(dx, dy);
    const pace = Math.hypot(velocity[0], velocity[1]);
    const flick = pace > FLICK_SPEED && distance > 16 && velocity[0] * dx + velocity[1] * dy > 0;
    if (event.type === "pointerup" && s.count > 1 && (distance > s.threshold || flick)) {
      sendToBack(pace > 300 ? velocity : [dx, dy], velocity);
    } else {
      const clamped: [number, number] = [
        clamp(velocity[0], -3000, 3000),
        clamp(velocity[1], -3000, 3000),
      ];
      placeAll({ released: drag.card, velocity: clamped });
    }
  };

  const onDown = (event: React.PointerEvent<HTMLDivElement>, index: number) => {
    if (event.button !== 0 || dragRef.current || openRef.current.open) return;
    if (orderRef.current[0] !== index || flyingRef.current.has(index)) return;
    const s = settingsRef.current;
    const values = valuesFor(index);
    const home = placement(s.layout, 0, index, s.spread, s.depth);
    const bounds = event.currentTarget.getBoundingClientRect();
    values.grabX.set(clamp((event.clientX - bounds.left) / Math.max(bounds.width, 1), 0, 1));
    values.grabY.set(clamp((event.clientY - bounds.top) / Math.max(bounds.height, 1), 0, 1));
    if (!s.reduceMotion) animate(values.lift, PRESS_SCALE, springFor(s, "press"));
    dragRef.current = {
      card: index,
      id: event.pointerId,
      element: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      originX: 0,
      originY: 0,
      homeX: home.x,
      homeY: home.y,
      vx: 0,
      vy: 0,
      idle: setTimeout(() => {}, 0),
      moved: false,
      progress: 0,
      samples: [[event.clientX, event.clientY, event.timeStamp]],
    };
    if (event.pointerType === "mouse") event.preventDefault();
    window.addEventListener("pointermove", listenersRef.current.move);
    window.addEventListener("pointerup", listenersRef.current.up);
    window.addEventListener("pointercancel", listenersRef.current.up);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Escape" && openRef.current.open) {
      event.preventDefault();
      openRef.current.toggle();
      return;
    }
    if (["ArrowRight", "ArrowDown", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      if (openRef.current.open) openRef.current.toggle();
      else sendToBack(null);
    }
  };

  actionsRef.current = { placeAll, sendToBack, onMove, onUp };
  if (!listenersRef.current) {
    listenersRef.current = {
      move: (event) => actionsRef.current.onMove?.(event),
      up: (event) => actionsRef.current.onUp?.(event),
    };
  }

  useIsomorphicLayoutEffect(() => {
    orderRef.current = order;
    actionsRef.current.placeAll({ stagger: mountedRef.current ? 0 : 0.06 });
    mountedRef.current = true;
  }, [order, shape, visible, spread, depth, speed, count]);

  const top = order[0];
  const changedRef = useRef(false);
  useEffect(() => {
    if (!changedRef.current) {
      changedRef.current = true;
      return;
    }
    if (top !== undefined) onChangeRef.current?.(top);
  }, [top]);

  // The timer restarts on every cycle: a fresh `order` means the last card
  // just went to the back and the next delay must start from zero.
  // biome-ignore lint/correctness/useExhaustiveDependencies: restart per cycle
  useEffect(() => {
    if (!autoplay || count < 2 || dragging || (pauseOnHover && hovered)) return undefined;
    const timer = setTimeout(
      () => actionsRef.current.sendToBack?.(null),
      Math.max(300, autoplayDelay)
    );
    return () => clearTimeout(timer);
  }, [autoplay, autoplayDelay, pauseOnHover, hovered, dragging, order, count]);

  useEffect(() => {
    aliveRef.current = true;
    const values = valuesRef.current;
    const listeners = listenersRef.current;
    return () => {
      aliveRef.current = false;
      if (dragRef.current) clearTimeout(dragRef.current.idle);
      window.removeEventListener("pointermove", listeners.move);
      window.removeEventListener("pointerup", listeners.up);
      window.removeEventListener("pointercancel", listeners.up);
      values.forEach((group) => {
        Object.values(group).forEach((value) => {
          value.stop();
        });
      });
    };
  }, []);

  const [originX, originY] = ORIGINS[shape];
  const innerRadius = Math.max(0, radius - frame);

  return (
    // A stack is a group the keyboard can cycle (arrows, Enter, Space): the
    // tabindex and the accessible name belong on this surface; no interactive
    // element carries the composite semantics.
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard-cyclable surface
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: labelled surface, no role
    <div
      ref={rootRef}
      className={`card-stack ${className}`.trim()}
      style={style}
      // A stack is a group the keyboard can cycle (arrows, Enter, Space); a div
      // with tabindex is the honest markup — no interactive element carries it.
      // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard-cyclable group
      tabIndex={0}
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {items(cards).map((card, index) => {
        const values = valuesFor(index);
        const isTop = order[0] === index;
        return (
          <motion.div
            // The position in the stack IS the card's identity; arbitrary
            // ReactNode cards carry no stable key of their own.
            // biome-ignore lint/suspicious/noArrayIndexKey: position-indexed cards
            key={index}
            ref={(element) => {
              if (element) elementsRef.current.set(index, element);
              else elementsRef.current.delete(index);
            }}
            className="card-stack-card"
            data-top={isTop ? "" : undefined}
            aria-hidden={isTop || expanded ? undefined : true}
            // A hidden card still contains real links. `aria-hidden` alone leaves them
            // in the tab order, which axe reports as aria-hidden-focus (WCAG 2.2 AA).
            // `inert` removes the whole subtree from focus and pointer interaction.
            inert={isTop || expanded ? undefined : true}
            style={{
              x: values.x,
              y: values.y,
              rotate: values.rotate,
              scale: values.scale,
              zIndex: values.z,
              opacity: values.opacity,
              originX,
              originY,
              cursor: expanded ? "pointer" : isTop ? (dragging ? "grabbing" : "grab") : "default",
              touchAction: isTop && !expanded ? "pan-y" : "auto",
            }}
            onPointerDown={(event) => onDown(event, index)}
            /* The dealt pile: every card is a link of its own. Folded, a click on
               a behind card deals the pile out instead of slipping through to
               the link; open, the top card folds instead of navigating. */
            onClickCapture={(event) => {
              if (!openRef.current.enabled) return;
              // The click trailing the toggling pointerup belongs to the same
              // gesture: swallow it, or the link would navigate (open→fold)
              // and the capture would fold what was just dealt (fold→open).
              if (performance.now() - suppressClickRef.current < 200) {
                event.preventDefault();
                event.stopPropagation();
                return;
              }
              if (openRef.current.open) {
                if (isTop) {
                  event.preventDefault();
                  event.stopPropagation();
                  openRef.current.toggle();
                }
              } else if (!isTop) {
                event.preventDefault();
                event.stopPropagation();
                openRef.current.toggle();
              }
            }}
          >
            <motion.div
              className="card-stack-face"
              style={{
                rotateX: values.tiltX,
                rotateY: values.tiltY,
                rotate: values.spin,
                scale: values.lift,
                originX: values.grabX,
                originY: values.grabY,
                transformPerspective: 800,
                borderRadius: radius,
                padding: frame,
                backgroundColor: frame > 0 ? frameColor : "transparent",
                boxShadow: shadow ? SHADOW : "none",
              }}
            >
              <div className="card-stack-content" style={{ borderRadius: innerRadius }}>
                {card}
              </div>
              <motion.div
                className="card-stack-shade"
                style={{ opacity: values.shade, borderRadius: radius }}
              />
            </motion.div>
          </motion.div>
        );
      })}
    </div>
  );
}

/** The source's default photos are remote and never used here; empty stack = nothing. */
const items = (cards?: ReactNode[]): ReactNode[] => cards ?? [];

export default Stack;
