# The desktop app: architecture, and where the plan was adjusted

This file records what the app actually does, and the three places where the original plan
would not have worked as written — with the reason, because a plan that is quietly not
followed is worse than one that is corrected.

## What runs where

| Layer                  | Content                                      | Runs                                     |
| ---------------------- | -------------------------------------------- | ---------------------------------------- |
| Window                 | The interface, as static files               | This machine                             |
| Local engine (sidecar) | agent, tools, audits, sandbox, index, doctor | This machine, `127.0.0.1` on a free port |
| Site API               | account, licence, projects, reports, sync    | Network, only when needed                |

The sidecar is **the same `proofcore` binary the CLI installers ship** (`extraResources`,
filtered per platform). One engine, two front doors, so the app and the terminal can never
disagree about what a tool does.

## Correction 1: this interface is Vite, not Next.js

The plan assumed Next.js with `output: 'export'`, and warned about `getServerSideProps` and
Server Actions. The web app in this repository is **Vite + React** (`apps/web`), which builds
to static files with no server rendering at all:

```bash
pnpm --filter @proofcore/web build     # → apps/web/dist, plain HTML/CSS/JS
```

So the "no SSR in the app" constraint is already satisfied — there is no SSR to remove, no
export mode to configure, and no Node server to embed. That removes an entire class of
problems from the plan, and it is the reason the app can start with the network unplugged.

## Correction 2: the auth token is an opaque session cookie, not a JWT

`proofcore login` stores `{ apiUrl, cookie: "ps_session=…", email, savedAt }`. There is no
`exp` claim to read. The gate therefore works from two clocks:

- if the token **is** a JWT, `exp` wins (`parseJwtExpiry` in `apps/desktop/src/access.cjs`);
- otherwise the deadline is `savedAt + graceDays` (7 by default, `PROOFCORE_OFFLINE_GRACE_DAYS`).

Everything else in the plan is implemented as designed:

| Rule                                   | Where                                                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Sign-in required before the tools open | `main.cjs` gates before starting the sidecar                                                               |
| Token in the OS vault                  | `src/store.cjs` — `safeStorage` (DPAPI / Keychain / libsecret), mode `0600`, sealed flag in the first byte |
| No vault available                     | writes a `0600` file and reports `mode: "file"` instead of implying protection it does not have            |
| Offline use within the window          | `evaluateAccess` → `status: "offline"`, days left in the menu                                              |
| Expired + offline                      | locked, with a local screen explaining why                                                                 |
| Site says account invalid (401/403)    | locked immediately, no grace: the site already answered                                                    |
| Revalidation                           | `GET /api/auth/session` with the stored cookie on every start, 4 s timeout                                 |

The locked screen is a **local** page (`src/login-page.cjs`): an app that needs the network to
explain that it needs the network cannot say "no network".

## Correction 3: two updaters, because there are two files

The plan had one. There are two different artifacts with two lifetimes:

| What                         | Updater            | Mechanism                                                                         |
| ---------------------------- | ------------------ | --------------------------------------------------------------------------------- |
| Engine (`sidecar/proofcore`) | `proofcore update` | release `manifest.json`, sha256 verified, old binary renamed aside first          |
| Window (the app)             | `electron-updater` | electron-builder's `latest*.yml`, served by our own API (`/api/v1/releases/assets/latest.yml`), silent download, install on quit |

A single updater would leave a window speaking a protocol the engine no longer has. Both are
idempotent, both refuse to run in a checkout, and the app shows "PRÊTE · s'installera à la
fermeture" rather than restarting under someone's hands mid-task.

## CORS

Not needed in this app, and worth saying why: the window loads `http://127.0.0.1:<port>`, and
the engine serves both the page and `/api/*` on that **same origin**, with a per-run token on
every request. There is no cross-origin request to allow, which is also why no CORS headers
were weakened on the site.

CORS _does_ matter if you switch to Tauri (Correction 4), where the origin becomes
`tauri://localhost` (Linux/macOS) or `http://tauri.localhost` (Windows). The site's CORS
configuration must then allow those two origins for `/api/*`.

## Correction 4: Tauri is the better shell, and it is one system dependency away

Tauri gives a ~10 MB binary using the OS webview instead of bundling Chromium. The code is
90 % there: what Tauri needs is (a) `libwebkit2gtk-4.1-dev` + `build-essential`, and (b) a
Rust shell around the same local server. On this machine the first is missing, and the disk
is at 100 % (under 1 GB free), so installing a few hundred megabytes of toolchain was not
something to do silently.

The port is mechanical:

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev \
  libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

pnpm create tauri-app@latest proofcore-shell --template vanilla-ts
cd proofcore-shell
pnpm add -D @tauri-apps/cli
pnpm tauri add shell fs os notification updater
```

Then, in the Rust shell: pick a free port, `Command::new(sidecar).args(["serve","--port",…])`,
read the tokenised URL from its stdout, and `WebviewWindow::navigate(url)`. The gate
(`access.cjs`) and the store (`store.cjs`) port as-is — they are pure modules; `safeStorage`
is replaced by `tauri-plugin-stronghold` or the OS keyring crate. `tauri-plugin-updater`
replaces `electron-updater`, signed with `TAURI_SIGNING_PRIVATE_KEY` in CI.

The only decision this changes for the user: a single file that is **both** the app and the
installer. electron-builder produces an installer (NSIS `.exe`, `.deb`, `.dmg`); Tauri can
produce a small standalone binary plus an NSIS/MSI installer, and with `--bundles appimage`
a single runnable file.

## Building

```bash
pnpm cli:binary --target linux-x64     # the engine the app carries
pnpm --filter @proofcore/desktop dist:linux   # deb + AppImage in artifacts/desktop
```

CI (`.github/workflows/desktop.yml`) builds Linux, Windows and macOS on every `app-v*` tag,
**launches each build** with `PROOFCORE_SMOKE=1` — which starts the engine, loads the window
and prints `SMOKE_OK` — and only then publishes. A missing session prints `SMOKE_LOCKED`,
which is the other half of the contract: the app must _not_ open without an account.

## What the smoke test proves

```
SMOKE_LOCKED reason=no-session          # no account on this machine → login screen
SMOKE_OK title=PROOFCORE · agent local  # account present → engine started, window loaded
```

Both were run against the packaged build (extracted from the `.deb`), not only from the
source tree.
