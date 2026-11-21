/**
 * The Testers.
 *
 * A small cast of ink characters who carry test objects and speak in speech bubbles.
 * They exist for empty states, loading and the 404 — never for errors, billing or a
 * destructive confirmation, where a joke would be an insult.
 *
 * The bubbles contain **real test-like strings** (a Beninese name with accents, a
 * Japanese name, a currency total, an export filename), not jokes about the product.
 * That is the point: the humour is technical, and the strings are the kind of value
 * PROOFSTACK actually breaks software with.
 *
 * Each character is one inline SVG under ~2KB, single stroke weight, no fills except the
 * bubble. Reduced motion renders them static — the pose carries the meaning, not the
 * animation.
 */

export type TesterPose = "carrying" | "looking" | "shrugging" | "walking" | "waiting";

export interface TesterProps {
  pose?: TesterPose;
  /** The line in the bubble. Use a real test string. */
  says?: string;
  size?: number;
  className?: string;
}

const STROKE = "#0A0A0B";

/** Shared drawing shell: consistent stroke weight, round caps, no fill. */
function Frame({
  size,
  children,
  className,
}: {
  size: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke={STROKE}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** A head with two dot eyes and a small mouth. The only face all characters share. */
function Head({ cx = 32, cy = 18, r = 6 }: { cx?: number; cy?: number; r?: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} />
      <circle cx={cx - r * 0.35} cy={cy - r * 0.15} r={0.7} fill={STROKE} stroke="none" />
      <circle cx={cx + r * 0.35} cy={cy - r * 0.15} r={0.7} fill={STROKE} stroke="none" />
      <path d={`M${cx - 1.6} ${cy + r * 0.45} q1.6 1.4 3.2 0`} />
    </g>
  );
}

/**
 * The carrier: holds a test object overhead. Used for empty states where the next step
 * is to bring data in.
 */
export function TesterCarrying({ size = 56, className }: TesterProps) {
  return (
    <Frame size={size} className={className}>
      <Head />
      {/* Body */}
      <path d="M32 24 v14" />
      {/* Arms up, holding a form field */}
      <path d="M32 28 L22 22 M32 28 L42 22" />
      <rect x="18" y="14" width="10" height="6" rx="1.5" />
      <rect x="36" y="14" width="10" height="6" rx="1.5" />
      {/* Legs, mid-stride */}
      <path d="M32 38 L27 50 M32 38 L37 50" />
    </Frame>
  );
}

/** The inspector: holds a magnifier over something it is reading. */
export function TesterLooking({ size = 56, className }: TesterProps) {
  return (
    <Frame size={size} className={className}>
      <Head cx={28} cy={18} />
      <path d="M28 24 v14" />
      <path d="M28 28 L38 32" />
      <circle cx="43" cy="35" r="5" />
      <path d="M46.5 38.5 L50 42" />
      <path d="M28 38 L24 50 M28 38 L33 50" />
    </Frame>
  );
}

/** The shrugger: nothing to report, and it says so. */
export function TesterShrugging({ size = 56, className }: TesterProps) {
  return (
    <Frame size={size} className={className}>
      <Head />
      <path d="M32 24 v14" />
      {/* Arms out, palms up */}
      <path d="M32 28 L20 26 M32 28 L44 26" />
      <path d="M20 26 l-2 -3 M44 26 l2 -3" />
      <path d="M32 38 L28 50 M32 38 L36 50" />
    </Frame>
  );
}

/** The walker: used for a loading state, crossing the empty table. */
export function TesterWalking({ size = 56, className }: TesterProps) {
  return (
    <Frame size={size} className={className}>
      <Head cx={34} cy={18} />
      <path d="M34 24 v14" />
      <path d="M34 28 L24 32 M34 28 L44 24" />
      <path d="M34 38 L26 50 M34 38 L42 48" />
      {/* A trailing file it is carrying */}
      <rect x="14" y="30" width="8" height="10" rx="1.5" />
    </Frame>
  );
}

/** The waiter: sits with a clock, for a queued or pending state. */
export function TesterWaiting({ size = 56, className }: TesterProps) {
  return (
    <Frame size={size} className={className}>
      <Head cx={26} cy={20} />
      <path d="M26 26 v10" />
      <path d="M26 30 L34 34" />
      <circle cx="44" cy="40" r="7" />
      <path d="M44 36 v4 l3 2" />
      <path d="M26 36 L22 48 M26 36 L30 48" />
    </Frame>
  );
}

const POSES: Record<TesterPose, (props: TesterProps) => React.ReactElement> = {
  carrying: TesterCarrying,
  looking: TesterLooking,
  shrugging: TesterShrugging,
  walking: TesterWalking,
  waiting: TesterWaiting,
};

/**
 * A tester with a speech bubble.
 *
 * The bubble is a real element with the string inside it, so a screen reader reads the
 * string — the illustration is `aria-hidden` but the content is not.
 */
export function Tester({ pose = "looking", says, size = 56, className }: TesterProps) {
  const Character = POSES[pose];
  if (!says) return <Character size={size} className={className} />;

  return (
    <span className={`inline-flex items-end gap-2 ${className ?? ""}`}>
      <Character size={size} />
      <span className="tester-bubble">{says}</span>
    </span>
  );
}

/**
 * A row of testers for an empty state.
 *
 * Each carries a different real value, which is the joke and the point: these are the
 * strings that break software, and nobody is testing them yet.
 */
export function TesterRow({ className }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-end justify-center gap-4 ${className ?? ""}`}>
      <Tester pose="carrying" says="Zoë-Marie N'Diaye" size={52} />
      <Tester pose="looking" says="名前" size={52} />
      <Tester pose="shrugging" says="ß ≠ SS ?" size={52} />
      <Tester pose="waiting" says="+229 01 97 …" size={52} />
      <Tester pose="walking" says="export_final_v2.csv" size={52} />
    </div>
  );
}

/**
 * A tester with a bubble, as a scene.
 *
 * This is the shape the loading and empty screens use: one character, one line, centred.
 * `variant` picks the pose; `bubble` is the line. Kept as a separate export because a
 * caller that wants a scene should not have to know which pose maps to which mood.
 */
export type TesterVariant = "working" | "empty" | "waiting" | "searching" | "lost";

export function TesterScene({
  variant = "working",
  bubble,
  size = 64,
  className,
}: {
  variant?: TesterVariant;
  bubble?: string;
  size?: number;
  className?: string;
}) {
  const pose: TesterPose =
    variant === "working"
      ? "walking"
      : variant === "waiting"
        ? "waiting"
        : variant === "searching" || variant === "lost"
          ? "looking"
          : "shrugging";

  return (
    <div className={`flex flex-col items-center gap-2 ${className ?? ""}`}>
      <Tester
        pose={pose}
        size={size}
        className={variant === "working" ? "tester-walk" : undefined}
      />
      {bubble ? <span className="tester-bubble">{bubble}</span> : null}
    </div>
  );
}
