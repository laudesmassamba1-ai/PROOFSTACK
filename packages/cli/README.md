# @proofstack/cli

The PROOFSTACK terminal client: project setup, module execution, reports, sync and the
interactive console.

> This package is private to the monorepo and is not published on npm. From the
> repository root, use `pnpm proofstack`. In another application directory, pass
> `--cwd /path/to/app` after the script separator.

## Quick start

```bash
# From the PROOFSTACK repository root
pnpm proofstack -- doctor
pnpm proofstack -- init
pnpm proofstack -- test --module world,flow,exit
pnpm proofstack -- report text
pnpm proofstack -- sync
```

The local `proofstack.config.ts` currently declares no WORLD HTTP target, no FLOW
checkout URL and no EXIT export source, so `test` reports every case as `SKIPPED` and
exits `2`. That is intentional: the CLI does not turn a missing target into a pass.
`pnpm proofstack -- doctor` lists exactly what must be wired.

## Interactive console

```bash
pnpm proofstack                 # full-screen console (requires a TTY)
pnpm proofstack -- login        # sign in; stores a 0600 session cookie
pnpm proofstack -- logout
pnpm proofstack -- status --json
pnpm proofstack -- ui --once --screen overview
```

The console follows the language of its interface only where translated; module names,
API states and report formats remain the technical identifiers. Sign-in uses
`PROOFSTACK_API_URL` (default `https://proofstack-iota.vercel.app`) or `--api`. For CI,
set `PROOFSTACK_SESSION_COOKIE` to the full cookie header
`ps_session=<value>`; the bare session value is not enough.

## Exit codes

| Code | Meaning                                     |
| ---- | ------------------------------------------- |
| `0`  | all executed cases passed (skips allowed)   |
| `1`  | at least one product defect                 |
| `2`  | harness error, invalid config or all skip   |
| `3`  | run cancelled                               |

A skipped case is not a pass. The report says `NONE` when nothing was verified.
