# CLI experience design

Overview:

- PROOFCORE CLI should feel premium, with a consistent visual language and clear process flows.
- The CLI uses the same design tokens as UI (color palette tokens translated to terminal colors).

Requirements:

- Terminal colors: mint (success), cyan (info), blue (active), amber (warning), red (error), gray (meta).
- Support NO_COLOR and --no-color; ANSI color escapes for TTYs; ASCII fallback for non-TTY.
- Progress system: show per-module progress, duration, successes/failures, and a concise summary.
- CLI help: consistent structure; commands list; examples.
- Interactive onboarding: gentle prompts for initial configuration with minimal questions.

Documentation:

- docs/CLI_EXPERIENCE.md will describe how to implement, test, and QA the CLI experience.
