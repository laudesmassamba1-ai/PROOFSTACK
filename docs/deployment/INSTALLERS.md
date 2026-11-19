# Desktop installers

PROOFCORE ships as an installer, not as a folder of files. One download per platform, a
double-click or one command, and `proofcore` works afterwards — on a machine with no Node,
no npm and no administrator rights.

The rule that shaped this: **your machine computes, the account remembers.** The agent loop,
the sandbox, the audits, the index and the browser you drive locally all run on your CPU.
The account is used for sign-in, projects, reports, sync and billing. Nothing about your
code is sent anywhere to be "processed for you" unless you ask for a cloud feature.

## What gets built

| File                                      | For                              | How it installs                                                                                                    |
| ----------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `proofcore-0.2.0-setup-win-x64.exe`       | Windows 10/11, x64               | Double-click. Installs to `%LOCALAPPDATA%\PROOFCORE`, adds the user `PATH`, adds a Start Menu entry. No elevation. |
| `proofcore-0.2.0-installer-linux-x64.run` | Linux x64 (Mint, Ubuntu, Debian) | `chmod +x` then run. Installs to `~/.local/share/proofcore`, adds one `PATH` line to your shell profile.           |
| `proofcore_0.2.0_amd64.deb`               | Debian, Ubuntu, Linux Mint       | `sudo dpkg -i proofcore_0.2.0_amd64.deb`                                                                           |
| `proofcore-0.2.0-installer-darwin-*.run`  | macOS Intel and Apple Silicon    | Same as Linux.                                                                                                     |

Every artifact is self-contained: the Node runtime the CLI needs is inside the file, so the
installation is one executable. That is also why the Windows setup is ~116 MB — it carries
the runtime _and_ the CLI it installs.

## How it is built

```bash
pnpm cli:binary --target win-x64        # artifacts/bin/proofcore-win-x64.exe
pnpm cli:installers --target win-x64    # artifacts/installers/…-setup-win-x64.exe
pnpm cli:binary:all                     # every target this host can cross-build
```

`tooling/scripts/build-binary.mjs` bundles the CLI to one CommonJS file with esbuild, turns
it into a Single Executable Application blob, and injects it into a Node binary for the
target platform (downloaded from nodejs.org when the target is not this host, which is why
a Windows `.exe` can be produced from Linux).

`tooling/scripts/build-installers.mjs` then wraps that binary:

- **Windows**: the setup file is itself a SEA binary — a Node runtime plus a small installer
  script — with the real CLI appended after it, gzipped, behind a marker. Windows ignores
  trailing bytes in a PE, so one `.exe` carries both. The builder re-reads its own output,
  finds the marker, checks the checksum and inflates the payload: a setup file that cannot
  install itself fails at build time, not on someone's laptop.
- **Linux and macOS**: a shell header followed by a `tar.gz`. The header locates the marker
  in its own file and extracts from there.
- **`.deb`**: a plain `dpkg-deb --build` tree, so `apt install ./file.deb` works.

## Getting them

Pushing a tag builds and publishes everything:

```bash
git tag v0.2.0
git push origin v0.2.0
```

`.github/workflows/release.yml` runs four jobs (Linux, Windows, macOS Intel, macOS Apple
Silicon). Each one **installs the installer it just built** and runs `proofcore --version`
before uploading, so a broken setup cannot be published.

Without CI, build locally:

```bash
pnpm cli:installers --target linux-x64     # what this machine can use
pnpm cli:installers --target win-x64       # works from Linux too
```

## After installing

```bash
proofcore login     # once: opens the browser, stores the session at 0600
proofcore           # full-screen hub
```

In the hub: `/help` lists everything, `/history` shows the commands of the session, `Tab`
completes a command, `↑`/`↓` walk the history, `PgUp`/`PgDn` scroll the transcript, `Ctrl+C`
interrupts a turn (twice leaves), `Ctrl+D` leaves.

Ignoring the menus entirely also works — anything without a leading slash is a prompt for
the agent.

## What the installer leaves behind

An install that produces a command but nothing to click is a folder with a story. Each
installer also writes:

| Piece            | Linux                                                                    | Windows                                               |
| ---------------- | ------------------------------------------------------------------------ | ----------------------------------------------------- |
| The command      | `~/.local/share/proofcore/bin/proofcore`                                 | `%LOCALAPPDATA%\PROOFCORE\bin\proofcore.exe`          |
| Icon             | `~/.local/share/icons/hicolor/256x256/apps/proofcore.png`                | `%LOCALAPPDATA%\PROOFCORE\icon.ico` (7 sizes, 16–256) |
| Launcher         | `~/.local/share/applications/proofcore.desktop` (both entries)           | `PROOFCORE\PROOFCORE.cmd`                             |
| Menu entry       | PROOFCORE + "PROOFCORE interface"                                        | Start Menu shortcuts, same two                        |
| Desktop icon     | `~/Desktop/PROOFCORE.desktop`, marked trusted with `gio` where available | Desktop shortcuts                                     |
| Package metadata | `dpkg-deb` control + `update-desktop-database` in postinst               | —                                                     |

The icon and the `.desktop` files are **generated by `packaging/assets.mjs`** — a 40-line PNG
writer (header, deflated scanlines, CRCs) and an ICO container that wraps those same PNGs.
Generated means the Windows `.ico` and the Linux `.png` cannot drift apart, and the mark is
the product's: dark tile, the white P, the one green accent bar.

The two entries are the two faces of the same thing:

- **PROOFCORE** opens the hub in a terminal (`Terminal=true`; on Windows the `.cmd` wrapper
  uses Windows Terminal when it is installed, and a plain console otherwise);
- **PROOFCORE interface** runs `proofcore app`, which opens the application in its own
  window.

`proofcore app` prefers a Chromium `--app=<url>` window: no tab strip, no address bar, its
own task-bar entry and icon — the same interface as the site, without shipping a second
browser engine. If no Chromium is installed it opens the default browser and says so, rather
than showing a blank frame. `proofcore app --print-url` gives the URL, `--json` gives
`{ url, appMode }`.

## The desktop application (native window)

`apps/desktop` is an Electron shell around the same local engine:

- the **sidecar** is the identical `proofcore` binary (extraResources `sidecar/proofcore`), so
  the app and the command cannot be different programs;
- the main process picks a free loopback port, starts `proofcore serve` there, reads the
  one-time URL it prints, and loads it in the window - the per-run token is required on every
  request, so the URL is the only way in and the cookie it sets keeps the window authorised;
- that cookie is scoped to `127.0.0.1`, not to the port. The app removes the previous run's
  cookie before loading the new URL; otherwise Electron restores a token that no longer
  matches the sidecar and every request answers `401`;
- the page runs locally: agent, tools, audits, sandbox, index. The network is used for the
  account, projects, reports and sync;
- a local splash covers the account check and sidecar startup. The sign-in window has a native
  frame so it can always be moved and closed; once signed in, the workspace uses its own
  compact 1180x800 title bar (minimum 820x600);
- account routes inside the window do not render the marketing navigation or footer: they
  use a desktop title bar instead, and the workspace switches to its compact menu below
  1180px;
- the native menu is gone; the "Moteur" panel owns the local engine, site, update and doctor
  actions, while the account menu owns settings, billing and sign-out;
- external links and payment/login pages open in the user's browser, never inside the window;
- one instance, sidecar killed on quit (taskkill on Windows), and the engine starts even with
  no model configured - the window explains what to set instead of refusing to open.

Build:

```bash
pnpm cli:binary --target linux-x64          # the sidecar
pnpm app:dist                               # deb + AppImage
```

`artifacts/desktop/PROOFCORE-0.4.0-amd64.deb` installs `/opt/PROOFCORE` (window + sidecar),
a `proofcore` launcher, the menu entry and the icon. Desktop packages are built for Linux
(`.deb`, `.AppImage`) and Windows (NSIS) in CI; macOS ships the CLI installer only, because
the desktop matrix has no macOS runner.

## Updates

The **desktop application** uses `electron-updater`. A published GitHub release must contain
`latest-linux.yml` / `latest.yml`; the `.github/workflows/release.yml` job builds both desktop
targets, verifies that the Linux manifest exists, and attaches it with the packages. The app
checks at startup, downloads in the background, installs on quit, and the Settings → “Ce
poste” card exposes a manual check. An AppImage replaces itself in place; a `.deb` is owned
by the system package manager, so the card reports that state and links to the release page
instead of showing a failed check. The version in `apps/desktop/package.json` must be higher
than the installed one before tagging a release.

The **CLI** knows how to update itself:

```bash
proofcore update            # asks the release manifest; shows what it would do
proofcore update --yes      # downloads, verifies the sha256, replaces the binary
proofcore update --check    # same as `update`, for scripts
proofcore update --json     # { current, latest, available, install, error }
```

The hub header shows `↑ 0.4.0 · /update` when a release is newer, and `proofcore --version`
adds one grey line on stderr (never on stdout, so a script parsing the version is unaffected).

Four rules make this safe rather than convenient:

1. **The manifest ships with the release**, and every file in it carries a sha256. A
   manifest without a usable digest for your platform is refused, not trusted.
2. **The download is verified before anything on disk changes.** A mismatch aborts.
3. **The old executable is renamed aside, never deleted first.** If the swap fails — a
   read-only folder, antivirus holding the Windows file — the old binary is put back and the
   message says so.
4. **The CLI only updates what it owns.** An npm installation is told to run
   `npm install -g proofcore@latest`; a checkout is told to `git pull`. Overwriting a
   package manager's files is how a machine ends up with two versions fighting.

Channels exist in the manifest (`stable`, `beta`); `proofcore update --channel beta` reads
the beta manifest when one is published.

## When something does not work: `proofcore doctor`

Not a wall of green ticks. Every line is a real probe, and every problem carries its fix:

```
project
ok   project             shop
warn lockfile            pnpm-lock.yaml, package-lock.json
     fix: Keep one: delete the others, then reinstall.
warn engines.node        requires >=20, running 18.20.0
     fix: Use a runtime that satisfies the project, or update the range if it is stale.

machine
ok   platform            linux-x64
ok   node                22.11.0
ok   config              ~/.config/proofcore
warn session permissions 644
     fix: chmod 600 ~/.config/proofcore/session.json
ok   executable          ~/.local/share/proofcore/bin
ok   docker              Docker version 27.0.0
ok   browser             /usr/bin/google-chrome (system)
warn disk                0.4 GB free
```

It covers the conflicts that actually happen: two lockfiles, a runtime outside the project's
`engines.node`, a Playwright runner and driver at different versions in your own project, two copies of React
("invalid hook call"), an unwritable config directory, a session file other users can read,
an install whose folder is read-only (self-update will refuse there), no Docker (so
`proofcore exec` refuses rather than running unisolated), and a terminal without colour.

## Permissions, by platform

| What                            | Linux / Mint                       | Windows                                             | macOS                                                                                     |
| ------------------------------- | ---------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Install                         | user folder, no sudo               | `%LOCALAPPDATA%`, no admin                          | user folder                                                                               |
| Session file                    | `0600`, folder `0700`              | same, per-user ACL                                  | same                                                                                      |
| PATH                            | one line in your shell profile     | user `PATH` variable                                | one line in your profile                                                                  |
| Running a downloaded binary     | `chmod +x` (the installer does it) | SmartScreen may ask once — "More info → Run anyway" | Gatekeeper: the build is ad-hoc signed; if it is refused, `xattr -d com.apple.quarantine` |
| Screen recording for `devtools` | not needed                         | not needed                                          | Screen Recording permission for the terminal, only for screenshots of your desktop        |
| Driving a browser               | not needed                         | not needed                                          | not needed (headless)                                                                     |

PROOFCORE never asks for administrator rights, and never needs them: it installs in your
profile, and its only privileged-looking feature — the sandbox — uses Docker, which you
install and control yourself.

## Uninstall

- Windows: delete `%LOCALAPPDATA%\PROOFCORE` and remove it from the user `PATH`; delete the
  Start Menu shortcut.
- Linux: `rm -rf ~/.local/share/proofcore` and remove the `# PROOFCORE` line from your shell
  profile.
- Debian: `sudo dpkg -r proofcore`.

## The old PC case

An i5 8th generation with 8 GB of RAM and no GPU is enough: none of the local tools need a
GPU. `pnpm cli:index` is TF-IDF over text, the audits speak HTTP, the sandbox is a container
if Docker is installed and refuses rather than running unisolated if it is not. The one
thing that wants a browser is `proofcore devtools` and the Hub's page, and a headless
Chromium runs fine on integrated graphics.

What you should _not_ expect on that machine: running a large local model. Point the hub at
a hosted provider (`proofcore agent --configure`) and keep the compute that matters — the
editing, the running, the auditing — local.
