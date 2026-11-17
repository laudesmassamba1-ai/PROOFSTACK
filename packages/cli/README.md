# @proofstack/cli

The PROOFSTACK terminal client: project setup, module execution, reports, sync and the
interactive console.

> This package is private to the monorepo and is not published on npm. The repository
> builds a self-contained global tarball; from any application directory, use
> `proofstack --cwd /path/to/app <command>`.

## Install globally

```bash
# From the PROOFSTACK repository root
pnpm cli:install
proofstack --version
```

`pnpm cli:install` builds a dependency-free bundle, packs it, installs it with npm and
checks the `proofstack` binary. To only produce the tarball:

```bash
pnpm cli:package
npm install -g ./artifacts/proofstack-cli-0.1.0.tgz
```

## Quick start in an application

```bash
proofstack --cwd /path/to/app init
proofstack --cwd /path/to/app doctor
proofstack --cwd /path/to/app test --module world,flow,exit
proofstack --cwd /path/to/app report text
proofstack --cwd /path/to/app sync
```

From the repository root, the equivalent in-repo command is
`pnpm proofstack -- --cwd /path/to/app <command>`.

The local `proofstack.config.ts` currently declares no WORLD HTTP target, no FLOW
checkout URL and no EXIT export source, so `test` reports every case as `SKIPPED` and
exits `2`. That is intentional: the CLI does not turn a missing target into a pass.
`pnpm proofstack -- doctor` lists exactly what must be wired.

## Interactive console

```bash
proofstack                      # full-screen console (requires a TTY)
proofstack login                # sign in; stores a 0600 session cookie
proofstack logout
proofstack status --json
proofstack ui --once --screen overview
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
