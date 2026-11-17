# CLI experience design

Published package: **`proofcore`** on npm (`npm install -g proofcore`). The workspace
package is `@proofcore/cli`; the release bundle is self-contained with no runtime
npm dependencies and requires Node.js ≥ 22.18. The legacy bin alias `proofstack`
ships in the same tarball and behaves identically.

## Design language

- The CLI should feel premium, with a consistent visual language and clear process flows.
- It uses the same design tokens as the web UI (color palette tokens translated to
  terminal colors).
- Terminal colors: mint (success), cyan (info), blue (active), amber (warning),
  red (error), gray (meta).
- `NO_COLOR`, `--no-color`, non-TTY and Windows are supported everywhere: on a
  non-TTY or piped stdout the CLI switches to deterministic plain output instead
  of ANSI escapes. The interactive console refuses to start without a TTY and
  explains what to use instead (`PROOFCORE_SESSION_COOKIE`, `--json`).

## Commands

```
proofcore init                      Create proofcore.config.ts in this directory
proofcore doctor                    Check the runtime, config and module wiring
proofcore validate                  Validate the configuration and exit
proofcore test [modules]            Run the enabled modules (WORLD/FLOW/EXIT)
proofcore report [text|json|junit|html]   Render the last run
proofcore projects                  List projects (session required)
proofcore sync                      Push the last run to the API (project token)
proofcore status                    Show the stored session and API target
proofcore login [--device] [--api URL]    Sign in
proofcore logout                    Remove the stored session
proofcore ui                        Full-screen terminal console
```

Exit codes are part of the contract: `0` pass, `1` product defect found,
`2` harness/environment error (never a defect), `3` cancelled by the user.

## Authentication

Three flows, for three real situations:

### 1. Interactive (`proofcore login`)

Email + password with terminal echo muted (raw-mode read; the password never
appears on screen or in shell history). The API returns an HttpOnly session
cookie; the CLI stores the cookie at `~/.config/proofcore/session.json` with
mode 0600 (`PROOFCORE_SESSION_FILE` overrides the path,
`PROOFCORE_CONFIG_HOME`/`XDG_CONFIG_HOME` the root).

### 2. Device authorization (`proofcore login --device`) — RFC 8628-style

For machines with no reachable browser: CI runners, SSH boxes, a teammate's
terminal. Verified end-to-end against the real API.

```
$ proofcore login --device

Open this URL on any device where you are signed in:
  https://proofstack-01z.pages.dev/device

Then enter this code:
  936N-E47R

Waiting for approval (expires in 10 min)…

Signed in as you@example.com.
Session stored at ~/.config/proofcore/session.json (mode 0600).
```

How it works, and what makes it trustworthy:

- `POST /api/auth/device/start` creates a grant: a 32-byte device code (only its
  SHA-256 is stored server-side) and a human-friendly user code typed into the
  verification page (alphabet without `0/O/1/I/L`).
- The CLI prints the code and polls `POST /api/auth/device/token` every 3 s
  (advisory interval, back-off on `slow_down`).
- The user opens `/device` in a browser where they are already signed in and
  chooses **Approve** or **Deny**. The decision is bound to that browser
  session — the device channel can never approve anything by itself.
- On approval the token endpoint mints a real session (same PBKDF2-backed auth
  model as sign-in), sets the cookie, and **consumes the grant**: one approval
  mints exactly one session. Denied or expired grants never mint one, and
  unknown device codes answer exactly like expired ones (no enumeration).
- Grants expire after 10 minutes; polling and approval are rate limited.

### 3. Non-interactive / CI

No prompts in scripts. Set `PROOFCORE_SESSION_COOKIE` for session-bound
commands (`ui`, `projects`), or create a **project token** in the dashboard
(`psk_…`) and export `PROOFCORE_PROJECT_TOKEN` for `proofcore sync`. Project
tokens authorize machine-to-machine reporting; they are unrelated to login.

## Runtime animations

The CLI animates only where it changes information, never for decoration:

- **Run progress** (`proofcore test`): a single in-place status line
  (`\r\x1B[K`) shows the active module in cyan plus `done / total · passed ·
  failed · warnings`, updated from engine events. On completion it is replaced
  by the summary — no line is left behind. Non-TTY output is event-per-line so
  CI logs stay readable.
- **Per-module results**: PASS (mint), FAIL (red), WARN (amber) with durations.
- **Device login**: a plain "waiting" line; every state change (pending →
  approved/denied/expired) is communicated in words. The code is printed in the
  terminal's monospace emphasis with letter-spacing via dashes, not ASCII art,
  so screen readers and copy-paste both work.
- **Terminal console** (`proofcore ui`): full-screen alternate-buffer render,
  repainted on state change (projects, runs, billing, admin screens), with a
  keyboard-first form system. It is a deterministic re-render, not a flicker of
  spinners.

`--json` disables presentation entirely and emits machine-readable output.

## Configuration discovery

`proofcore.config.ts` (or `.js`, `.json`) in the working directory; the legacy
`proofstack.config.*` names are still accepted read-only. `proofcore doctor`
reports which file was found, which modules it enables, and any environment
problem (Node version, API reachability, missing tokens) without ever inventing
a passing result.

## QA

- Every flow above is exercised by tests: device authorization in
  `apps/api/test/device.test.ts` (grant lifecycle, consumption, denial,
  enumeration resistance), auth and sessions in `apps/api/test/auth.test.ts`,
  the port contract in `apps/api/test/ports.test.ts`.
- The published bundle is smoke-tested (`proofcore --version`, `--help`,
  `doctor` failing loudly without config) after every release build.
- Manual QA checklist: `NO_COLOR=1`, piped output, Windows PowerShell, slow
  network (poll back-off), and the deny path from the browser page.
