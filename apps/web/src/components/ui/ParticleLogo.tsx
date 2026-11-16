/**
 * Compatibility entry point.
 *
 * The original UI-local prototype duplicated the particle engine and shipped an
 * unfinished parser state. The canonical implementation lives next to the brand
 * geometry so the animated mark and the static mark share one source of truth.
 */

export type {
  ParticleLogoProps,
  ParticlePalette,
} from "../brand/ParticleLogo.js";
export { ParticleLogo } from "../brand/ParticleLogo.js";
