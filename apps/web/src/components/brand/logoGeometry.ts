/**
 * The PROOFSTACK monogram is one P cut into three offset plates.
 *
 * The silhouette is a single P path with an even-odd bowl cutout. Three copies,
 * offset down and to the right, read as WORLD (back), FLOW (middle) and EXIT
 * (front) while still being one legible mark at 16 px. The same path data feeds
 * the SVG logo and the Canvas 2D particle sampler, so the animated logo cannot
 * drift from the printed mark.
 */

export const LOGO_VIEWBOX = 96;

export const LOGO_PATH =
  "M18 84V12H50C73 12 86 25 86 44C86 61 74 72 52 72H32V84Z" +
  "M32 26V58H50C61 58 68 51 68 44C68 33 61 26 50 26Z";

export interface LogoLayer {
  /** Offset in the 96-unit viewBox. The front plate is last. */
  offset: number;
  color: string;
  opacity: number;
}

export const LOGO_LAYERS: readonly LogoLayer[] = [
  { offset: 9, color: "#70C9DB", opacity: 0.58 },
  { offset: 4.5, color: "#78E3CB", opacity: 0.86 },
  { offset: 0, color: "#73D68B", opacity: 1 },
] as const;

export const LOGO_LIGHT_LAYERS: readonly LogoLayer[] = [
  { offset: 9, color: "#2B6F8F", opacity: 0.42 },
  { offset: 4.5, color: "#2C7A67", opacity: 0.7 },
  { offset: 0, color: "#185B49", opacity: 1 },
] as const;

export const LOGO_MONO_LAYERS: readonly LogoLayer[] = [
  { offset: 9, color: "#F2F6FA", opacity: 0.28 },
  { offset: 4.5, color: "#F2F6FA", opacity: 0.58 },
  { offset: 0, color: "#F2F6FA", opacity: 1 },
] as const;
