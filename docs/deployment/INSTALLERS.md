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

In the hub: `/help` lists everything, `Tab` completes a command, `↑`/`↓` walk the history,
`PgUp`/`PgDn` scroll the transcript, `Ctrl+C` interrupts a turn (twice leaves), `Ctrl+D`
leaves.

Ignoring the menus entirely also works — anything without a leading slash is a prompt for
the agent.

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
