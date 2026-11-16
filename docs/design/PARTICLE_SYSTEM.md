# Particle system design (Proofstack)

Goal:
- Provide an original, performant particle-based identity that forms the PROOFSTACK symbol.
- Use a Canvas 2D engine with deterministic particle distribution and smooth transitions.

Architecture:
- Particle data model: position, velocity, target, size, color.
- Canvas-based rendering with requestAnimationFrame.
- A soft physics-like attraction towards logo target coordinates to form the symbol.
- Multiple states:
  - State A: flowing wave surface.
  - State B: logo formation.
  - State C: logo integrity with subtle micro-motions.
  - State D: dissolution back to waves.
  - State E: pointer interaction.
  - State F: scroll interaction.

Configuration:
- density: particle count per area.
- waveIntensity: strength of wave fields.
- particleSize: visual size of particles.
- animationSpeed: overall speed multiplier.
- colorPalette: array of colors used by particles.
- interactionRadius: radius for pointer interaction influence.
- logoFormationDuration: time for logo to form in ms.
- reducedMotion: honor media query for reduced motion.
- performanceMode: reduces workload on low-end devices.

Implementation notes:
- Prefer Canvas 2D over WebGL for simplicity and reliability.
- Expose a reusable component ParticleLogo with props for customization.
- Provide a static SVG fallback for non-Canvas environments.
- Ensure cleanup on unmount and visibility checks to pause when not visible.
