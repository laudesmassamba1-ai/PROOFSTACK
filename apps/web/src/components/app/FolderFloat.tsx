/*
 * Adapted from "FolderFloat" by React Bits (https://reactbits.dev), MIT licence.
 * Changes for this codebase: named export, TypeScript types, timers as
 * ReturnType<typeof setTimeout>, no react-hooks lint comments (biome), and the
 * colours arrive through props so hosts can pass app tokens (--ink, --surface…).
 * Behaviour, physics and animation are the source's own.
 */
import Matter from "matter-js";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import "./FolderFloat.css";

const { Bodies, Body, Composite, Engine } = Matter;

export interface FolderFloatItem {
  label: string;
  value: string;
}

export interface FolderFloatProps {
  /** The pills that float out. A string is its own value. */
  items?: Array<string | FolderFloatItem>;
  /** The line on the flap. */
  label?: string;
  /** The dimmer line under it. Empty counts the notes. */
  sublabel?: string;
  /** Open on hover, or toggle on press. */
  trigger?: "hover" | "click";
  defaultOpen?: boolean;
  /** Picking a pill closes the folder. */
  closeOnSelect?: boolean;
  /** Once the pills land, a zero-gravity world takes over. */
  physics?: boolean;
  /** Strength of the floating currents in the world. 0 holds still. */
  drift?: number;
  onSelect?: (value: string, index: number) => void;
  onOpenChange?: (open: boolean) => void;
  folderColor?: string;
  frontColor?: string;
  paperColor?: string;
  itemColor?: string;
  itemTextColor?: string;
  labelColor?: string;
  /** Folder width in px. */
  width?: number;
  /** Folder height in px, below the tab. */
  height?: number;
  /** Corner radius in px. */
  radius?: number;
  /** Half the widest the cloud may be, in px. */
  spread?: number;
  /** Gap between the folder and the lowest row, in px. */
  lift?: number;
  /** Most a pill leans, in degrees. */
  tilt?: number;
  /** How far the flap tilts toward you when open, in degrees. */
  flapAngle?: number;
  /** The flap tilt when closed, in degrees. */
  restAngle?: number;
  /** A pill's rise, in ms. The close is 60% of it. */
  openDuration?: number;
  /** Delay between pills, in ms. The close reverses the order. */
  stagger?: number;
  /** Overshoot of the rise. 0 lands dead. */
  bounce?: number;
  className?: string;
}

const DEFAULT_ITEMS: Array<string | FolderFloatItem> = [
  "Try a warmer palette",
  "Tighten the spacing",
  "Logo feels small",
  "Love the new hero",
];
const PAD = 28;
const CHAR = 6.8;
const GAP = 12;
const ROW = 52;
const DRAG_MIN = 4;
const ZONE_PAD = 8;

interface PillSize {
  w: number;
  h: number;
}

interface PillPos {
  x: number;
  y: number;
  r: number;
}

const jitter = (i: number): number => {
  const x = Math.sin(i * 12.9898 + 4.1414) * 43758.5453;
  return x - Math.floor(x);
};

const layout = (
  list: FolderFloatItem[],
  spread: number,
  lift: number,
  tilt: number,
  sizes: PillSize[]
): PillPos[] => {
  const rows: { items: { i: number; pw: number }[]; width: number }[] = [];
  let row: { i: number; pw: number }[] = [];
  let width = 0;
  list.forEach((item, i) => {
    const pw = sizes[i]?.w ?? PAD + item.label.length * CHAR;
    if (row.length && width + GAP + pw > spread * 2) {
      rows.push({ items: row, width });
      row = [];
      width = 0;
    }
    row.push({ i, pw });
    width += (row.length > 1 ? GAP : 0) + pw;
  });
  if (row.length) rows.push({ items: row, width });
  const pos: PillPos[] = [];
  rows.forEach((r, ri) => {
    let x = -r.width / 2;
    const shift = (ri % 2 ? 1 : -1) * Math.min(16, spread * 0.1);
    r.items.forEach(({ i, pw }) => {
      const j = jitter(i);
      pos[i] = {
        x: x + pw / 2 + shift + (j - 0.5) * 6,
        y: -lift - ri * ROW - j * 6,
        r: tilt * (j * 2 - 1),
      };
      x += pw + GAP;
    });
  });
  return pos;
};

export function FolderFloat({
  items = DEFAULT_ITEMS,
  label = "Design feedback",
  sublabel = "",
  trigger = "hover",
  defaultOpen = false,
  closeOnSelect = true,
  physics = true,
  drift = 0.5,
  onSelect,
  onOpenChange,
  folderColor = "#3f3f46",
  frontColor = "#52525b",
  paperColor = "#f5f5f5",
  itemColor = "#f5f5f5",
  itemTextColor = "#18181b",
  labelColor = "#f5f5f5",
  width = 200,
  height = 148,
  radius = 14,
  spread = 180,
  lift = 26,
  tilt = 8,
  flapAngle = 34,
  restAngle = 16,
  openDuration = 520,
  stagger = 45,
  bounce = 0.3,
  className = "",
}: FolderFloatProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [popped, setPopped] = useState(-1);
  const [live, setLive] = useState(false);
  const [sizes, setSizes] = useState<PillSize[]>([]);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const pillRefs = useRef<(HTMLButtonElement | null)[]>([]);
  type World = {
    engine: Matter.Engine | null;
    bodies: Matter.Body[];
    sizes: PillSize[];
    raf: number;
    last: number;
    t0: number;
    drag: {
      i: number;
      id: number;
      dx: number;
      dy: number;
      sx: number;
      sy: number;
      moved: boolean;
    } | null;
    zone: { left: number; right: number; top: number; bottom: number } | null;
    live: boolean;
  };
  const world = useRef<World>({
    engine: null,
    bodies: [],
    sizes: [],
    raf: 0,
    last: 0,
    t0: 0,
    drag: null,
    zone: null,
    live: false,
  });
  const latest = useRef<{
    onSelect?: FolderFloatProps["onSelect"];
    onOpenChange?: FolderFloatProps["onOpenChange"];
    drift: number;
    reduce: boolean;
    lite: boolean;
  }>({ drift, reduce: false, lite: false });
  latest.current = { onSelect, onOpenChange, drift, reduce: false, lite: false };
  const popTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const liveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const list: FolderFloatItem[] = items.map((item) =>
    typeof item === "string" ? { label: item, value: item } : item
  );
  const n = list.length;
  const sub = sublabel || `${n} ${n === 1 ? "note" : "notes"}`;
  const pos = layout(list, spread, lift, tilt, sizes);
  // Positions change identity on every render (layout recomputes), but the physics
  // world only needs to read the latest ones when it starts — a ref keeps the
  // callbacks dependency-stable.
  const posRef = useRef(pos);
  posRef.current = pos;

  useLayoutEffect(() => {
    const measure = () => {
      const next = pillRefs.current
        .slice(0, n)
        .map((el) => (el ? { w: el.offsetWidth, h: el.offsetHeight } : null));
      if (next.some((s) => !s)) return;
      setSizes((prev) =>
        prev.length === next.length &&
        prev.every((s, i) => s && next[i] && s.w === next[i]?.w && s.h === next[i]?.h)
          ? prev
          : (next as PillSize[])
      );
    };
    measure();
    document.fonts?.ready.then(measure);
  }, [n]);

  const stopPhysics = useCallback(() => {
    const w = world.current;
    clearTimeout(liveTimer.current);
    cancelAnimationFrame(w.raf);
    w.raf = 0;
    if (w.engine) {
      w.bodies.forEach((b, i) => {
        const el = pillRefs.current[i];
        const size = w.sizes[i];
        if (!el || !size) return;
        el.style.setProperty("--x", `${b.position.x.toFixed(1)}px`);
        el.style.setProperty("--y", `${(b.position.y - size.h / 2).toFixed(1)}px`);
      });
      Composite.clear(w.engine.world, false, true);
      Engine.clear(w.engine);
      w.engine = null;
    }
    w.bodies = [];
    w.drag = null;
    w.live = false;
    setLive(false);
  }, []);

  const startPhysics = useCallback(() => {
    const w = world.current;
    if (w.engine) return;
    const els = pillRefs.current.slice(0, n);
    if (els.some((el) => !el)) return;
    // The guard above proved every entry exists; this alias only drops the null
    // that noUncheckedIndexedAccess keeps seeing in the array type.
    const measured = els as HTMLButtonElement[];
    const posNow = posRef.current;
    const engine = Engine.create({ gravity: { x: 0, y: 0 } });
    engine.enableSleeping = false;
    w.engine = engine;
    w.sizes = measured.map((el) => ({ w: el.offsetWidth, h: el.offsetHeight }));
    const ys = posNow.map((p) => p.y);
    const zone = {
      left: -spread - ZONE_PAD,
      right: spread + ZONE_PAD,
      top: Math.min(...ys) - ZONE_PAD,
      bottom: -lift + Math.max(...w.sizes.map((s) => s.h)),
    };
    w.zone = zone;
    w.bodies = measured.map((_, i) => {
      const size = w.sizes[i] ?? { w: PAD, h: ROW };
      const at = posNow[i] ?? { x: 0, y: 0, r: 0 };
      const b = Bodies.rectangle(at.x, at.y + size.h / 2, size.w, size.h, {
        chamfer: { radius: Math.min(size.h / 2 - 1, 16) },
        restitution: 0.55,
        friction: 0,
        frictionAir: 0.08,
        inertia: Infinity,
      });
      b.plugin = { phase: jitter(i) * Math.PI * 2 };
      return b;
    });
    const T = 80;
    const walls = [
      Bodies.rectangle(
        (zone.left + zone.right) / 2,
        zone.top - T / 2,
        zone.right - zone.left + 2 * T,
        T,
        {
          isStatic: true,
        }
      ),
      Bodies.rectangle(
        (zone.left + zone.right) / 2,
        zone.bottom + T / 2,
        zone.right - zone.left + 2 * T,
        T,
        {
          isStatic: true,
        }
      ),
      Bodies.rectangle(
        zone.left - T / 2,
        (zone.top + zone.bottom) / 2,
        T,
        zone.bottom - zone.top + 2 * T,
        {
          isStatic: true,
        }
      ),
      Bodies.rectangle(
        zone.right + T / 2,
        (zone.top + zone.bottom) / 2,
        T,
        zone.bottom - zone.top + 2 * T,
        {
          isStatic: true,
        }
      ),
    ];
    Composite.add(engine.world, [...w.bodies, ...walls]);
    w.live = true;
    w.last = 0;
    w.t0 = performance.now();
    setLive(true);
    const tick = (now: number) => {
      const s = world.current;
      if (!s.engine) return;
      const dt = s.last ? Math.min(32, now - s.last) : 16;
      s.last = now;
      const t = (now - s.t0) / 1000;
      const k = latest.current.drift * 0.00005 * Math.min(1, t / 2);
      s.bodies.forEach((b, i) => {
        if (s.drag && s.drag.i === i) return;
        const ph = (b.plugin as { phase?: number }).phase ?? 0;
        Body.applyForce(b, b.position, {
          x: Math.sin(t * 0.9 + ph) * k * b.mass,
          y: Math.cos(t * 1.3 + ph * 1.7) * k * b.mass,
        });
      });
      Engine.update(s.engine, dt);
      s.bodies.forEach((b, i) => {
        const el = pillRefs.current[i];
        const size = s.sizes[i];
        if (!el || !size) return;
        el.style.setProperty("--x", `${b.position.x.toFixed(1)}px`);
        el.style.setProperty("--y", `${(b.position.y - size.h / 2).toFixed(1)}px`);
      });
      s.raf = requestAnimationFrame(tick);
    };
    w.raf = requestAnimationFrame(tick);
    // Positions are read through posRef, so the world restarts only when the
    // folder's geometry actually changes (count, spread, lift).
  }, [n, spread, lift]);

  const set = useCallback(
    (next: boolean) => {
      if (!next) stopPhysics();
      setOpen((prev) => {
        if (prev === next) return prev;
        latest.current.onOpenChange?.(next);
        return next;
      });
    },
    [stopPhysics]
  );

  useEffect(() => {
    clearTimeout(liveTimer.current);
    if (!open || !physics || latest.current.reduce || latest.current.lite) {
      if (!open) stopPhysics();
      else if (!physics) stopPhysics();
      return undefined;
    }
    liveTimer.current = setTimeout(startPhysics, openDuration + (n - 1) * stagger + 80);
    return () => clearTimeout(liveTimer.current);
  }, [open, physics, openDuration, stagger, n, startPhysics, stopPhysics]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    /* Petit écran ou puce modeste : le dossier flotte sans simulation. La
     * physique matter-js tourne à 60 Hz pour un effet décoratif — sur un
     * vieux téléphone c'est la dépense la plus chère de la page. L'éventail
     * garde sa position CSS et le toucher : rien ne se perd à l'œil. */
    const liteMq = window.matchMedia("(max-width: 767px)");
    const sync = () => {
      latest.current.reduce = mq.matches;
      latest.current.lite =
        liteMq.matches || (navigator.hardwareConcurrency ?? 8) <= 4;
    };
    sync();
    mq.addEventListener("change", sync);
    liteMq.addEventListener("change", sync);
    return () => {
      mq.removeEventListener("change", sync);
      liteMq.removeEventListener("change", sync);
    };
  }, []);

  useEffect(
    () => () => {
      clearTimeout(popTimer.current);
      stopPhysics();
    },
    [stopPhysics]
  );

  const pick = (item: FolderFloatItem, i: number) => {
    latest.current.onSelect?.(item.value, i);
    clearTimeout(popTimer.current);
    setPopped(i);
    popTimer.current = setTimeout(() => setPopped(-1), 320);
    if (closeOnSelect) set(false);
  };

  const pointerAt = (e: React.PointerEvent) => {
    const r = anchorRef.current?.getBoundingClientRect();
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: 0, y: 0 };
  };
  const down = (e: React.PointerEvent, i: number) => {
    const w = world.current;
    if (!w.live || e.button !== 0) return;
    const b = w.bodies[i];
    if (!b) return;
    const p = pointerAt(e);
    w.drag = {
      i,
      id: e.pointerId,
      dx: b.position.x - p.x,
      dy: b.position.y - p.y,
      sx: e.clientX,
      sy: e.clientY,
      moved: false,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* setPointerCapture is unavailable on some synthetic events; drag still works. */
    }
  };
  const move = (e: React.PointerEvent, i: number) => {
    const w = world.current;
    const d = w.drag;
    if (!d || d.i !== i || d.id !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) >= DRAG_MIN) {
      d.moved = true;
      e.currentTarget.setAttribute("data-drag", "");
    }
    if (!d.moved) return;
    const b = w.bodies[i];
    const size = w.sizes[i];
    const z = w.zone;
    if (!b || !size || !z) return;
    const p = pointerAt(e);
    const x = Math.min(z.right - size.w / 2, Math.max(z.left + size.w / 2, p.x + d.dx));
    const y = Math.min(z.bottom - size.h / 2, Math.max(z.top + size.h / 2, p.y + d.dy));
    Body.setVelocity(b, { x: (x - b.position.x) * 0.6, y: (y - b.position.y) * 0.6 });
    Body.setPosition(b, { x, y });
  };
  const up = (e: React.PointerEvent, i: number, item: FolderFloatItem) => {
    const w = world.current;
    const d = w.drag;
    if (!d || d.i !== i || d.id !== e.pointerId) return;
    w.drag = null;
    e.currentTarget.removeAttribute("data-drag");
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* releasePointerCapture on an already-released id throws; nothing to undo. */
    }
    if (!d.moved && e.type === "pointerup") pick(item, i);
  };

  const hover = trigger === "hover";

  return (
    /* The semantics live on the children (the trigger button announces the
     * folder and its state; the pills are buttons). The root is the pointer
     * surface for open/close and Escape, which no element role expresses. */
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer surface, semantics on children
    <div
      className={`folder-float${className ? ` ${className}` : ""}`}
      data-open={open ? "" : undefined}
      data-live={live ? "" : undefined}
      data-physics={physics ? "" : undefined}
      data-trigger={trigger}
      onPointerEnter={hover ? () => set(true) : undefined}
      onPointerLeave={
        hover
          ? () => {
              if (!world.current.drag) set(false);
            }
          : undefined
      }
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          set(false);
        }
      }}
      style={
        {
          "--ff-w": `${width}px`,
          "--ff-h": `${height}px`,
          "--ff-r": `${radius}px`,
          "--ff-back": folderColor,
          "--ff-front": frontColor,
          "--ff-paper": paperColor,
          "--ff-item": itemColor,
          "--ff-item-ink": itemTextColor,
          "--ff-label": labelColor,
          "--ff-spread": `${spread}px`,
          "--ff-lift": `${lift}px`,
          "--ff-angle": `${flapAngle}deg`,
          "--ff-rest": `${restAngle}deg`,
          "--ff-open": `${openDuration}ms`,
          "--ff-close": `${Math.round(openDuration * 0.6)}ms`,
          "--ff-stagger": `${stagger}ms`,
          "--ff-n": n,
          "--ff-spring": `cubic-bezier(0.34, ${(1 + bounce * 1.9).toFixed(2)}, 0.64, 1)`,
        } as React.CSSProperties
      }
    >
      <div ref={anchorRef} className="folder-float__items">
        {list.map((item, i) => {
          const p = pos[i] ?? { x: 0, y: 0, r: 0 };
          return (
            <button
              key={`${item.value}::${item.label}`}
              ref={(el) => {
                pillRefs.current[i] = el;
              }}
              type="button"
              className="folder-float__item"
              tabIndex={open ? 0 : -1}
              aria-hidden={!open}
              data-pop={popped === i ? "" : undefined}
              style={
                {
                  "--i": i,
                  "--x": `${p.x.toFixed(1)}px`,
                  "--y": `${p.y.toFixed(1)}px`,
                  "--r": `${p.r.toFixed(2)}deg`,
                } as React.CSSProperties
              }
              onPointerDown={(e) => down(e, i)}
              onPointerMove={(e) => move(e, i)}
              onPointerUp={(e) => up(e, i, item)}
              onPointerCancel={(e) => up(e, i, item)}
              onClick={(e) => {
                if (!world.current.live || e.detail === 0) pick(item, i);
              }}
            >
              <span className="folder-float__drift">{item.label}</span>
            </button>
          );
        })}
      </div>
      <div className="folder-float__folder">
        <span className="folder-float__back" aria-hidden="true" />
        <span className="folder-float__paper" aria-hidden="true" />
        <span className="folder-float__front" aria-hidden="true">
          <span className="folder-float__label">{label}</span>
          <span className="folder-float__sub">{sub}</span>
        </span>
        <button
          type="button"
          className="folder-float__trigger"
          aria-expanded={open}
          aria-label={`${label}, ${sub}`}
          onClick={() => set(!open)}
        />
      </div>
    </div>
  );
}

export default FolderFloat;
