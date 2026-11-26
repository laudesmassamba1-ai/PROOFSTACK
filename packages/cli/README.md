# @proofcore/cli

The PROOFCORE terminal client: project setup, module execution, reports, sync and the
interactive console.

> This package is private to the monorepo and is not published on npm. The repository
> builds a self-contained global tarball; from any application directory, use
> `proofcore --cwd /path/to/app <command>`.

## Install globally

```bash
# From the PROOFCORE repository root
pnpm cli:install
proofcore --version
```

`pnpm cli:install` builds a dependency-free bundle, packs it, installs it with npm and
checks the `proofcore` binary. To only produce the tarball:

```bash
pnpm cli:package
npm install -g ./artifacts/proofcore-cli-0.1.0.tgz
```

## Quick start in an application

Open a terminal in your application directory, then run:

```bash
cd /path/to/your/app   # replace with a real, existing directory
proofcore init
proofcore doctor
proofcore test --module world,flow,exit
proofcore report text
proofcore sync
```

`init` writes `proofcore.config.ts` in the current directory and never creates the
directory. `--cwd /path/to/your/app` also works, but that directory must already exist;
the CLI exits with code 2 and an actionable message otherwise. From the repository root,
the equivalent in-repo command is `pnpm proofcore -- --cwd /path/to/app <command>`.

The local `proofcore.config.ts` currently declares no WORLD HTTP target, no FLOW
checkout URL and no EXIT export source, so `test` reports every case as `SKIPPED` and
exits `2`. That is intentional: the CLI does not turn a missing target into a pass.
`pnpm proofcore -- doctor` lists exactly what must be wired.

## Interactive console

```bash
proofcore                      # full-screen console (requires a TTY)
proofcore login                # sign in; stores a 0600 session cookie
proofcore logout
proofcore status --json
proofcore ui --once --screen overview
```

The console follows the language of its interface only where translated; module names,
API states and report formats remain the technical identifiers. Sign-in uses
`PROOFCORE_API_URL` (default `https://proofstack-iota.vercel.app`) or `--api`. For CI,
set `PROOFCORE_SESSION_COOKIE` to the full cookie header
`ps_session=<value>`; the bare session value is not enough.

## Exit codes

| Code | Meaning                                   |
| ---- | ----------------------------------------- |
| `0`  | all executed cases passed (skips allowed) |
| `1`  | at least one product defect               |
| `2`  | harness error, invalid config or all skip |
| `3`  | run cancelled                             |

A skipped case is not a pass. The report says `NONE` when nothing was verified.
