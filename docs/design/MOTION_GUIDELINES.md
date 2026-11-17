# Motion guidelines — workspace

Motion explains state. It is never ambient noise.

## Timing

| Interaction | Duration |
| --- | --- |
| Hover / focus | 120–160ms |
| Small transition | 160–220ms |
| Dialog / sheet | 180–260ms |
| Large layout or object settle | 240–400ms |

One family: `cubic-bezier(.2,.8,.2,1)`. No bounce on ordinary UI. No parallax.

## Signature moves

1. **Headline reveal** — lines rise 10–14px on first load only; not on every route change.
2. **Object settle** — module object enters with opacity and 8–12px translation.
3. **Orbit / chain / stack state** — a passed link lights up, a failed link opens, a
   failed slab offsets. Animate once when data changes.
4. **Table inversion** — row background becomes ink and text becomes paper on hover;
   140ms, no scale.
5. **Mobile sheet** — paper sheet rises 12px and fades in; giant links stagger 30ms.

## Loops

- WORLD orbit may rotate slowly (24–40s) only when the module has a run.
- FLOW and EXIT do not loop; their state is static.
- Pause all loops off-screen with `IntersectionObserver`, and when the tab is hidden.
- Cancel animation frames and observers on unmount.

## Loading

Prefer a walking Tester, a rotating object ring, or a short textual state. Do not fill
every panel with skeleton shimmer. Loading must not imply data exists.

## Reduced motion

`prefers-reduced-motion: reduce`:

- No orbit rotation, tester sway, headline rise or sheet translation.
- Object states remain fully visible and distinguishable without animation.
- Loading remains understandable as text.
- No information is lost.

## Performance

- Animate transform and opacity only.
- No layout reads in an animation frame.
- No new runtime animation dependency.
- The workspace must remain interactive while an object animates.
