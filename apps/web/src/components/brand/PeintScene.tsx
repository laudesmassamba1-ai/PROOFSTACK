import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "../../i18n/index.js";

/**
 * La scène du héros — les particules SONT l'image.
 *
 * Aucun aplat: chaque visuel est dessiné par une nuée de grains de pigment qui
 * convergent depuis le chaos vers leur place, tiennent, puis se dispersent vers
 * le visuel suivant. Une chorégraphie de 16 s en boucle:
 *
 *   1. les grains forment un « P » (fût + panse, tracé puis rempli);
 *   2. les grains deviennent la Terre: le pourtour, les continents — la carte
 *      tourne en se défilant dans le disque —, l'océan scintille;
 *   3. puis les grains dessinent chaque module, l'un après l'autre:
 *      WORLD (la Terre), FLOW (la carte bancaire), EXIT (la boîte d'export et
 *      sa flèche), FAIL (le bouclier et son point d'exclamation), CLEAN
 *      (le check dans son cercle, avec ses étincelles).
 *
 * Positions déterministes (PRNG seedé): rendu stable, zéro réseau, zéro WebGL.
 * Les animations ne touchent que transform/opacity des groupes.
 */

/** PRNG déterministe — le même tableau à chaque rendu. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Pt {
  x: number;
  y: number;
  r?: number;
  c?: string;
}

/** Échantillonne un segment en n points. */
function line(a: Pt, b: Pt, n: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return pts;
}

/** Échantillonne un cercle en n points. */
function ring(cx: number, cy: number, r: number, n: number, phase = 0): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

/** Échantillonne un arc de cercle (angles en radians, repère SVG). */
function arc(cx: number, cy: number, r: number, a0: number, a1: number, n: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (a1 - a0) * (i / (n - 1));
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

/** Échantillonne une ellipse posée à plat (une pièce vue de trois quarts). */
function piece(cx: number, cy: number, rx: number, ry: number, n: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return pts;
}

/** Un trait pointillé: un point tous les « pas », un trou à chaque fois. */
function pointille(a: Pt, b: Pt, pas = 22, trou = 12): Pt[] {
  const pts: Pt[] = [];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  for (let d = 0; d < len; d += pas + trou) {
    const t0 = d / len;
    const t1 = Math.min(d + pas, len) / len;
    pts.push({
      x: a.x + (dx * (t0 + t1)) / 2,
      y: a.y + (dy * (t0 + t1)) / 2,
      r: 2.2,
      c: "rgba(22, 19, 15, 0.45)",
    });
  }
  return pts;
}

/** Remplit un polygone en n points (rejet: dans le polygone, jamais dehors). */
function poly(verts: Pt[], n: number, seed: number): Pt[] {
  const rand = prng(seed);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of verts) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }
  const inside = (p: Pt): boolean => {
    let hit = false;
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
      const a: Pt = verts[i] as Pt;
      const b: Pt = verts[j] as Pt;
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
        hit = !hit;
      }
    }
    return hit;
  };
  const pts: Pt[] = [];
  let guard = 0;
  while (pts.length < n && guard < n * 60) {
    guard++;
    const p = { x: minX + rand() * (maxX - minX), y: minY + rand() * (maxY - minY) };
    if (inside(p)) pts.push(p);
  }
  return pts;
}

const ENCRE = "var(--galerie-ink)";
const VERMILLON = "var(--vermillon)";
const OUTREMER = "var(--outremer)";
const OCRE = "var(--ocre)";

/** Une nuée: les grains, avec leur point de départ dispersé (vars CSS). */
function Nuage({
  pts,
  seed,
  colors = [VERMILLON, OUTREMER, OCRE],
  rMin = 2,
  rMax = 4.4,
  scatter = 300,
  className,
}: {
  pts: Pt[];
  seed: number;
  colors?: string[];
  rMin?: number;
  rMax?: number;
  scatter?: number;
  className?: string;
}) {
  const rand = prng(seed);
  return (
    <g className={className}>
      {pts.map((p, i) => {
        const ang = rand() * Math.PI * 2;
        const dist = scatter * (0.35 + rand() * 0.65);
        return (
          <circle
            key={`${Math.round(p.x)}-${Math.round(p.y)}-${Math.round((p.r ?? 0) * 100)}`}
            className="peint-grain"
            cx={p.x + (rand() - 0.5) * 4}
            cy={p.y + (rand() - 0.5) * 4}
            r={p.r ?? rMin + rand() * (rMax - rMin)}
            fill={p.c ?? colors[i % colors.length]}
            style={
              {
                "--sx": `${Math.cos(ang) * dist}px`,
                "--sy": `${Math.sin(ang) * dist}px`,
                "--od": `${(1.6 + rand() * 2.2).toFixed(2)}s`,
              } as CSSProperties
            }
          />
        );
      })}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Les visuels, en coordonnées de particules                          */
/* ------------------------------------------------------------------ */

/* Le P: pourtour du fût, pourtour de la panse, remplissage lâche. */
function particulesP(): Pt[] {
  const contour: Pt[] = [
    ...line({ x: 600, y: 224 }, { x: 600, y: 556 }, 8),
    ...line({ x: 692, y: 556 }, { x: 692, y: 224 }, 8),
    ...line({ x: 600, y: 224 }, { x: 692, y: 224 }, 4),
    ...line({ x: 600, y: 556 }, { x: 692, y: 556 }, 4),
    ...ring(768, 352, 146, 22, 0.4),
    ...ring(768, 352, 96, 10, 1.1),
  ];
  const remplissage = poly(
    [
      { x: 606, y: 230 },
      { x: 686, y: 230 },
      { x: 686, y: 550 },
      { x: 606, y: 550 },
    ],
    16,
    5
  ).map((p) => ({ ...p, r: 1.8 + (p.x % 3) }));
  return [...contour, ...remplissage];
}

/* La Terre: pourtour du disque, continents en grappes denses, océan clairsemé.
   Les continents vivent dans un ruban équirectangulaire 600×240 (dédoublé
   pour défiler sans couture): c'est le défilement du ruban qui fait tourner
   la planète. */
const MONDE_W = 600;

const CONTINENTS: { poly: Pt[]; n: number; c?: string }[] = [
  {
    poly: [
      { x: 20, y: 80 },
      { x: 45, y: 35 },
      { x: 85, y: 20 },
      { x: 130, y: 22 },
      { x: 160, y: 40 },
      { x: 150, y: 60 },
      { x: 165, y: 80 },
      { x: 150, y: 100 },
      { x: 158, y: 118 },
      { x: 140, y: 135 },
      { x: 120, y: 150 },
      { x: 128, y: 165 },
      { x: 112, y: 185 },
      { x: 95, y: 175 },
      { x: 80, y: 150 },
      { x: 55, y: 130 },
      { x: 35, y: 105 },
    ],
    n: 40,
  },
  {
    poly: [
      { x: 172, y: 15 },
      { x: 200, y: 20 },
      { x: 196, y: 45 },
      { x: 172, y: 50 },
      { x: 162, y: 32 },
    ],
    n: 7,
  },
  {
    poly: [
      { x: 118, y: 150 },
      { x: 138, y: 145 },
      { x: 152, y: 160 },
      { x: 150, y: 190 },
      { x: 140, y: 220 },
      { x: 124, y: 236 },
      { x: 110, y: 226 },
      { x: 104, y: 200 },
      { x: 106, y: 172 },
    ],
    n: 30,
    c: VERMILLON,
  },
  {
    poly: [
      { x: 258, y: 60 },
      { x: 272, y: 40 },
      { x: 296, y: 32 },
      { x: 312, y: 42 },
      { x: 306, y: 58 },
      { x: 290, y: 66 },
      { x: 272, y: 72 },
      { x: 260, y: 70 },
    ],
    n: 16,
  },
  {
    poly: [
      { x: 266, y: 92 },
      { x: 292, y: 82 },
      { x: 316, y: 94 },
      { x: 322, y: 118 },
      { x: 312, y: 150 },
      { x: 298, y: 186 },
      { x: 284, y: 206 },
      { x: 272, y: 196 },
      { x: 264, y: 160 },
      { x: 258, y: 124 },
    ],
    n: 38,
  },
  {
    poly: [
      { x: 320, y: 40 },
      { x: 350, y: 20 },
      { x: 395, y: 12 },
      { x: 440, y: 18 },
      { x: 480, y: 34 },
      { x: 500, y: 55 },
      { x: 492, y: 75 },
      { x: 468, y: 80 },
      { x: 450, y: 95 },
      { x: 440, y: 115 },
      { x: 425, y: 130 },
      { x: 410, y: 120 },
      { x: 395, y: 108 },
      { x: 370, y: 112 },
      { x: 345, y: 105 },
      { x: 328, y: 88 },
      { x: 318, y: 66 },
    ],
    n: 44,
  },
  {
    poly: [
      { x: 398, y: 120 },
      { x: 416, y: 116 },
      { x: 420, y: 134 },
      { x: 410, y: 152 },
      { x: 398, y: 158 },
      { x: 392, y: 140 },
    ],
    n: 12,
    c: VERMILLON,
  },
  {
    poly: [
      { x: 472, y: 168 },
      { x: 492, y: 158 },
      { x: 516, y: 164 },
      { x: 524, y: 182 },
      { x: 512, y: 200 },
      { x: 490, y: 204 },
      { x: 476, y: 192 },
    ],
    n: 18,
  },
];

function continentsDuMonde(offsetX: number, seed: number): Pt[] {
  const pts: Pt[] = [];
  let s = seed;
  for (const c of CONTINENTS) {
    s += 7;
    pts.push(
      ...poly(c.poly, c.n, s).map((p) => ({ ...p, x: p.x + offsetX, c: c.c ?? OCRE, r: 2.2 }))
    );
  }
  // Madagascar, Japon, Indonésie, Nouvelle-Zélande, îlots
  pts.push(
    { x: 338 + offsetX, y: 180, r: 2.6, c: OCRE },
    { x: 512 + offsetX, y: 84, r: 2.4, c: OCRE },
    { x: 466 + offsetX, y: 152, r: 2.4, c: OCRE },
    { x: 488 + offsetX, y: 158, r: 2, c: OCRE },
    { x: 540 + offsetX, y: 214, r: 2.2, c: OCRE },
    { x: 560 + offsetX, y: 130, r: 2, c: OCRE }
  );
  return pts;
}

/* FLOW: la rangée de pièces posées à plat, comme dans la vraie image. */
function particulesFlow(): Pt[] {
  const pts: Pt[] = [];
  // une pièce plus haute, puis la rangée qui descend doucement vers la droite
  const pieces: [number, number][] = [
    [640, 288],
    [576, 356],
    [674, 364],
    [772, 372],
    [868, 380],
  ];
  for (const [cx, cy] of pieces) {
    pts.push(...piece(cx, cy, 52, 16, 8).map((p) => ({ ...p, c: ENCRE, r: 2.4 })));
    pts.push(
      ...line({ x: cx - 36, y: cy }, { x: cx + 36, y: cy }, 3).map((p) => ({
        ...p,
        c: ENCRE,
        r: 2.2,
      }))
    );
  }
  // la pointillée sous la rangée
  pts.push(...pointille({ x: 520, y: 428 }, { x: 930, y: 428 }));
  return pts;
}

/* EXIT: le losange flottant, posé sur sa boîte en pointillés. */
function particulesExit(): Pt[] {
  const pts: Pt[] = [
    // le losange (plat, incliné comme la vraie image)
    ...line({ x: 560, y: 300 }, { x: 730, y: 236 }, 7).map((p) => ({ ...p, c: OCRE, r: 2.8 })),
    ...line({ x: 730, y: 236 }, { x: 902, y: 300 }, 7).map((p) => ({ ...p, c: OCRE, r: 2.8 })),
    ...line({ x: 902, y: 300 }, { x: 732, y: 368 }, 7).map((p) => ({ ...p, c: OCRE, r: 2.8 })),
    ...line({ x: 732, y: 368 }, { x: 560, y: 300 }, 7).map((p) => ({ ...p, c: OCRE, r: 2.8 })),
    // remplissage léger du plat
    ...poly(
      [
        { x: 560, y: 300 },
        { x: 730, y: 236 },
        { x: 902, y: 300 },
        { x: 732, y: 368 },
      ],
      14,
      67
    ).map((p) => ({ ...p, c: OCRE, r: 2.2 })),
    // la boîte en pointillés, dessous
    ...pointille({ x: 560, y: 430 }, { x: 902, y: 430 }),
    ...pointille({ x: 902, y: 430 }, { x: 902, y: 540 }),
    ...pointille({ x: 902, y: 540 }, { x: 560, y: 540 }),
    ...pointille({ x: 560, y: 540 }, { x: 560, y: 430 }),
  ];
  return pts;
}

/* FAIL: la jauge, l'aiguille vers la gauche, le point vermillon. */
function particulesFail(): Pt[] {
  return [
    ...arc(740, 480, 172, Math.PI, 0, 22).map((p) => ({ ...p, c: ENCRE, r: 2.6 })),
    ...line({ x: 740, y: 480 }, { x: 590, y: 480 }, 6).map((p) => ({ ...p, c: ENCRE, r: 2.8 })),
    { x: 570, y: 480, r: 6.4, c: VERMILLON },
    { x: 740, y: 480, r: 5.2, c: ENCRE },
  ];
}

/* CLEAN: la même jauge, l'aiguille vers la droite, le point ocre. */
function particulesClean(): Pt[] {
  return [
    ...arc(740, 480, 172, Math.PI, 0, 22).map((p) => ({ ...p, c: ENCRE, r: 2.6 })),
    ...line({ x: 740, y: 480 }, { x: 886, y: 480 }, 6).map((p) => ({ ...p, c: ENCRE, r: 2.8 })),
    { x: 570, y: 480, r: 6.4, c: OCRE },
    { x: 740, y: 480, r: 5.2, c: ENCRE },
  ];
}

const label = (name: string, tag: string, y = 700) => (
  <g className="peint-etiquette">
    <text x="700" y={y} textAnchor="middle" fontSize="24" letterSpacing="8">
      {name}
    </text>
    <text x="700" y={y + 30} textAnchor="middle" fontSize="17" opacity="0.6">
      {tag}
    </text>
  </g>
);

export function PeintScene() {
  const { t } = useI18n();

  /* l'océan: points clairsemés dans le disque (une seule copie, pas de ruban) */
  const randOcean = prng(13);
  const ocean: Pt[] = [];
  for (let i = 0; i < 60; i++) {
    const a = randOcean() * Math.PI * 2;
    const r = Math.sqrt(randOcean()) * 204;
    ocean.push({
      x: 770 + Math.cos(a) * r,
      y: 400 + Math.sin(a) * r,
      r: 1.5 + randOcean() * 1.3,
      c: "rgba(42, 63, 209, 0.32)",
    });
  }

  /* poussière d'atelier: points d'encre qui scintillent, toujours là */
  const randDust = prng(7);
  const poussiere: ReactNode[] = [];
  for (let i = 0; i < 22; i++) {
    poussiere.push(
      <circle
        key={i}
        cx={60 + randDust() * 1080}
        cy={60 + randDust() * 660}
        r={1.6 + randDust() * 1.8}
        fill="var(--galerie-ink)"
        opacity={0.16 + randDust() * 0.14}
        style={{ "--od": `${(2.4 + randDust() * 2.6).toFixed(2)}s` } as CSSProperties}
      />
    );
  }

  return (
    <svg
      className="peint-scene"
      viewBox="0 0 1200 810"
      role="img"
      aria-label={t("hero.scene.aria")}
    >
      <defs>
        <clipPath id="clip-terre">
          <circle cx="770" cy="400" r="216" />
        </clipPath>
      </defs>

      <g className="peint-poussiere">{poussiere}</g>

      {/* ACTE 1 — les grains forment le P */}
      <Nuage pts={particulesP()} seed={3} className="peint-ph-P" scatter={340} />

      {/* ACTE 2 — les grains deviennent la Terre: pourtour, carte qui défile, océan */}
      <g className="peint-ph-terre">
        <g clipPath="url(#clip-terre)">
          <Nuage
            pts={ocean}
            seed={17}
            colors={["rgba(42, 63, 209, 0.3)"]}
            rMin={1.4}
            rMax={2.6}
            scatter={26}
            className="peint-ocean"
          />
          <g transform="translate(0 286) scale(1.18)">
            <g className="peint-ruban">
              <Nuage
                pts={continentsDuMonde(0, 23)}
                seed={23}
                colors={[OCRE, VERMILLON]}
                rMin={2}
                rMax={3.6}
                scatter={120}
                className="peint-grains-terre"
              />
              <Nuage
                pts={continentsDuMonde(MONDE_W, 24)}
                seed={24}
                colors={[OCRE, VERMILLON]}
                rMin={2}
                rMax={3.6}
                scatter={120}
                className="peint-grains-terre"
              />
            </g>
          </g>
        </g>
        {/* le pourtour du disque, en grains d'encre */}
        <Nuage
          pts={ring(770, 400, 218, 44, 0.15)}
          seed={27}
          colors={[ENCRE]}
          rMin={2}
          rMax={3.2}
          scatter={60}
          className="peint-contour"
        />
        {/* l'orbite pointillée de la vraie image */}
        <Nuage
          pts={ring(770, 400, 262, 20, 0.2).filter((_, i) => i % 2 === 0)}
          seed={28}
          colors={["rgba(22, 19, 15, 0.4)"]}
          rMin={2}
          rMax={2.6}
          scatter={30}
          className="peint-orbite-pointillee"
        />
        {label("WORLD", t("modules.world.tag"))}
      </g>

      {/* ACTE 3 — les grains dessinent chaque module */}

      {/* FLOW: la carte bancaire */}
      <g className="peint-mod peint-mod-flow">
        <Nuage
          pts={particulesFlow()}
          seed={41}
          colors={[VERMILLON, OUTREMER]}
          rMin={2.4}
          rMax={4.6}
          scatter={260}
        />
        {label("FLOW", t("modules.flow.tag"))}
      </g>

      {/* EXIT: la boîte d'export et sa flèche */}
      <g className="peint-mod peint-mod-exit">
        <Nuage
          pts={particulesExit()}
          seed={43}
          colors={[OCRE, VERMILLON]}
          rMin={2.4}
          rMax={4.6}
          scatter={260}
        />
        {label("EXIT", t("modules.exit.tag"))}
      </g>

      {/* FAIL: le bouclier et son point d'exclamation */}
      <g className="peint-mod peint-mod-fail">
        <Nuage
          pts={particulesFail()}
          seed={47}
          colors={[OUTREMER, VERMILLON]}
          rMin={2.2}
          rMax={4.2}
          scatter={260}
        />
        {label("FAIL", t("modules.fail.tag"))}
      </g>

      {/* CLEAN: le check dans son cercle, avec ses étincelles */}
      <g className="peint-mod peint-mod-clean">
        <Nuage
          pts={particulesClean()}
          seed={53}
          colors={[OCRE, OUTREMER]}
          rMin={2.4}
          rMax={4.6}
          scatter={260}
        />
        {label("CLEAN", t("modules.clean.tag"))}
      </g>
    </svg>
  );
}
