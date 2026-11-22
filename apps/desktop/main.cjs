/**
 * The desktop application.
 *
 * Two processes, on purpose:
 *
 * - this one (Electron) draws the window, owns the lifecycle and the native actions;
 * - the sidecar (the same `proofcore` binary people install from the CLI) does all the
 *   work: reading the repository, running the agent, the audits, the sandbox, the index.
 *
 * Everything the app can do, it does on this machine. The network is used for the account,
 * the projects, the reports and the sync - the same endpoints the web app uses - and for
 * nothing else. That is why the window loads `127.0.0.1`, not the site: a packaged app that
 * silently turns into a browser wrapper is not a native app.
 */

const {
  app,
  BrowserWindow,
  WebContentsView,
  Menu,
  dialog,
  shell,
  ipcMain,
  nativeTheme,
  safeStorage,
  net,
  screen,
  session,
} = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { createServer } = require("node:net");
const { join } = require("node:path");
const { cpus, homedir, totalmem } = require("node:os");
const { chmodSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { evaluateAccess, normalizeStoredSession } = require("./src/access.cjs");
const { createStore } = require("./src/store.cjs");
const { loginPageHtml } = require("./src/login-page.cjs");
const { signInWithCredentials } = require("./src/sign-in.cjs");
const { splashPageHtml } = require("./src/splash-page.cjs");
const { createBrowserHost } = require("./src/browser.cjs");

const SMOKE = process.env.PROOFCORE_SMOKE === "1";
const SITE_API =
  process.env.PROOFCORE_API_URL ?? "https://proofcore-api.laudesmassamba1.workers.dev";

/** One window, one sidecar: a second launch focuses the first instead of starting another. */
if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow = null;
let loginWindow = null;
let splashWindow = null;
let accessState = null;
let store = null;
let sidecar = null;
let sidecarPort = 0;
let sidecarUrl = null;
let resolveSidecarUrl = () => {};
const sidecarUrlReady = new Promise((resolve) => {
  resolveSidecarUrl = resolve;
});
const sidecarLog = [];
let appUpdater = null;
let updateState = { status: "idle", version: null, percent: 0, message: null };

/**
 * The Chromium view used by the in-app browser. It is registered once, at startup, so the
 * interface can open a page before any window exists without racing the IPC channel.
 */
const browserHost = createBrowserHost({
  app,
  WebContentsView,
  shell,
  session,
  getWindow: () => mainWindow,
  send: (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  },
});
browserHost.register(ipcMain);

function broadcastUpdate() {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("proofcore:update", updateState);
  }
}

function setUpdateState(next) {
  updateState = { ...updateState, ...next };
  broadcastUpdate();
}

function log(line) {
  sidecarLog.push(line);
  if (sidecarLog.length > 400) sidecarLog.shift();
  if (!app.isPackaged || SMOKE) process.stdout.write(`[sidecar] ${line}\n`);
}

/** A small local window between double-click and the first real screen. */
function showSplash() {
  if (SMOKE || splashWindow) return;
  const window = new BrowserWindow({
    width: 430,
    height: 260,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    show: false,
    center: true,
    skipTaskbar: true,
    backgroundColor: "#0b0d10",
    title: "PROOFCORE",
  });
  splashWindow = window;
  window.setMenuBarVisibility(false);
  window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashPageHtml())}`);
  window.once("ready-to-show", () => {
    if (!window.isDestroyed()) window.show();
  });
  window.on("closed", () => {
    if (splashWindow === window) splashWindow = null;
  });
}

function closeSplash() {
  const window = splashWindow;
  splashWindow = null;
  if (window && !window.isDestroyed()) window.destroy();
}

/** Smoke runs are short-lived; stop the sidecar before exiting or the next build gets ETXTBSY. */
function exitSmoke(code) {
  closeSplash();
  // The sidecar's exit handler must not open the "engine stopped" dialog during a test.
  app.isQuitting = true;
  if (!sidecar || sidecar.killed || sidecar.exitCode !== null) {
    app.exit(code);
    return;
  }
  const finish = () => app.exit(code);
  const timer = setTimeout(finish, 1500);
  sidecar.once("exit", () => {
    clearTimeout(timer);
    finish();
  });
  sidecar.kill();
}

/** A free port on the loopback interface, chosen by the OS rather than guessed. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Where the sidecar lives. Packaged: next to the app, in Resources/sidecar. Development:
 * the workspace build, run through Electron's own Node so nothing else has to be installed.
 */
function sidecarCommand(port) {
  const exeName = process.platform === "win32" ? "proofcore.exe" : "proofcore";
  const candidates = [
    process.env.PROOFCORE_SIDECAR,
    join(process.resourcesPath ?? "", "sidecar", "proofcore"),
    join(process.resourcesPath ?? "", "sidecar", exeName),
    // extraResources keeps the build's own name, so both spellings are accepted.
    join(
      process.resourcesPath ?? "",
      "sidecar",
      `proofcore-${process.platform === "win32" ? "win" : process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`
    ),
    join(
      __dirname,
      "..",
      "..",
      "artifacts",
      "bin",
      `proofcore-${process.platform === "win32" ? "win" : process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`
    ),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { file: candidate, args: ["serve", "--port", String(port)], cwd: safeCwd() };
    }
  }

  // Development fallback: the TypeScript build, executed by this Electron's Node.
  const devEntry = join(__dirname, "..", "..", "packages", "cli", "dist", "index.js");
  if (existsSync(devEntry)) {
    return {
      file: process.execPath,
      args: [devEntry, "serve", "--port", String(port)],
      cwd: safeCwd(),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    };
  }
  return null;
}

/** The built web app, packaged next to the sidecar. */
function webRoot() {
  const packaged = join(process.resourcesPath ?? "", "web");
  if (existsSync(join(packaged, "index.html"))) return packaged;
  const development = join(__dirname, "..", "..", "apps", "web", "dist");
  return existsSync(join(development, "index.html")) ? development : null;
}

/** The working directory the agent should open: the user's project, not the app bundle. */
function safeCwd() {
  const fromEnv = process.env.PROOFCORE_APP_CWD;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return process.env.HOME ?? process.env.USERPROFILE ?? app.getPath("home");
}

async function startSidecar() {
  sidecarPort = await freePort();
  const command = sidecarCommand(sidecarPort);
  if (!command) {
    throw new Error("the local engine is missing from this build (Resources/sidecar)");
  }
  log(`starting ${command.file} ${command.args.join(" ")}`);

  const interfaceRoot = webRoot();
  if (interfaceRoot) log(`interface ${interfaceRoot}`);
  sidecar = spawn(command.file, command.args, {
    cwd: command.cwd,
    env: {
      ...process.env,
      ...(command.env ?? {}),
      PROOFCORE_APP: "1",
      PROOFCORE_API_URL: SITE_API,
      ...(interfaceRoot ? { PROOFCORE_WEB_ROOT: interfaceRoot } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  sidecar.stdout.setEncoding("utf8");
  sidecar.stderr.setEncoding("utf8");
  sidecar.stdout.on("data", (chunk) => {
    const text = chunk.trimEnd();
    log(text);
    // The local engine prints a one-time URL carrying its per-run token. That URL is the
    // only way in: the cookie it sets is what keeps the window authenticated afterwards.
    const match = /(http:\/\/127\.0\.0\.1:\d+\/\?(?:t|token)=[A-Za-z0-9_%.-]+)/.exec(text);
    if (match?.[1] && !sidecarUrl) {
      sidecarUrl = match[1];
      resolveSidecarUrl(sidecarUrl);
    }
  });
  sidecar.stderr.on("data", (chunk) => log(chunk.trimEnd()));
  sidecar.on("exit", (code) => {
    log(`exited ${code}`);
    if (!app.isQuitting && mainWindow) {
      dialog.showErrorBox(
        "PROOFCORE",
        `Le moteur local s'est arrêté (code ${code}).\n\n${sidecarLog.slice(-12).join("\n")}`
      );
    }
  });

  // Readiness is "the engine printed its URL", not an unauthenticated probe: every route
  // needs the per-run token, so polling without it would only ever see 401.
  const url = await Promise.race([
    sidecarUrlReady,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("the local engine did not print an address in 25s")),
        25_000
      )
    ),
  ]);
  return { port: sidecarPort, url };
}

/**
 * Where the CLI keeps its session, which is the same account this app uses.
 *
 * This mirrors `sessionFilePath()` in `packages/cli/src/ui.ts` exactly. They used to differ
 * on Windows (APPDATA here, ~/.config there) and when PROOFCORE_CONFIG_HOME was set, so a
 * terminal login was invisible to the app.
 */
function cliSessionPath() {
  const home = homedir();
  const root =
    process.env.PROOFCORE_CONFIG_HOME?.trim() ||
    process.env.XDG_CONFIG_HOME?.trim() ||
    join(home, ".config");
  return join(root, "proofcore", "session.json");
}

function readCliSession() {
  try {
    const parsed = JSON.parse(readFileSync(cliSessionPath(), "utf8"));
    if (parsed && (parsed.cookie || parsed.token)) return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * Asks the site whether this session is still good. Three answers matter and they lead to
 * three different screens: 2xx = verified, 401/403 = refused (expired, revoked, subscription
 * ended), anything else = the site is unreachable and the grace window applies.
 */
function verifySession(session) {
  const apiUrl = typeof session?.apiUrl === "string" ? session.apiUrl : null;
  if (!apiUrl) return Promise.resolve({ online: null, revoked: false });
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const request = net.request({
        method: "GET",
        url: new URL("/api/auth/session", apiUrl).toString(),
      });
      if (session.cookie) request.setHeader("Cookie", session.cookie);
      else if (session.token) request.setHeader("Authorization", `Bearer ${session.token}`);
      const timer = setTimeout(() => {
        request.abort();
        done({ online: false, revoked: false });
      }, 4000);
      request.on("response", (response) => {
        clearTimeout(timer);
        response.on("data", () => undefined);
        response.on("end", () => {
          if (response.statusCode >= 200 && response.statusCode < 300)
            done({ online: true, revoked: false });
          else if (response.statusCode === 401 || response.statusCode === 403)
            done({ online: true, revoked: true });
          else done({ online: true, revoked: false });
        });
      });
      request.on("error", () => {
        clearTimeout(timer);
        done({ online: false, revoked: false });
      });
      request.end();
    } catch {
      done({ online: false, revoked: false });
    }
  });
}

/**
 * Decides whether the app may run, and remembers where the answer came from.
 *
 * Order matters: the vault first (it is the copy this app owns), then the CLI's session (so
 * signing in once with the terminal is enough), then the site, then the clock.
 */
async function gate() {
  store = createStore({ dir: app.getPath("userData"), safeStorage });
  let session = store.load();
  let importedFromCli = false;

  if (!session || session.error) {
    const fromCli = readCliSession();
    const normalized = normalizeStoredSession(fromCli, SITE_API);
    if (normalized) {
      // Stored with the apiUrl the verification probe needs: a CLI session imported
      // without one could never be re-confirmed and would age out on the grace clock.
      store.save(normalized);
      session = normalized;
      importedFromCli = true;
    } else if (session?.error === "vault-locked") {
      // Do not overwrite a sealed file we cannot read: it is a login that exists, and
      // destroying it would force a new one for a keyring that is only temporarily locked.
      session = null;
    }
  }

  const probe = await verifySession(session);
  accessState = {
    ...evaluateAccess({
      session,
      now: Date.now(),
      online: probe.online,
      revoked: probe.revoked,
      graceDays: Number(process.env.PROOFCORE_OFFLINE_GRACE_DAYS ?? 7),
    }),
    source: importedFromCli ? "cli" : "vault",
    vault: store.mode,
    checkedAt: new Date().toISOString(),
  };
  return accessState;
}

/** The locked screen: a local page that explains, with one action that can actually work. */
function showLoginWindow(state) {
  if (loginWindow) {
    loginWindow.focus();
    return;
  }
  loginWindow = new BrowserWindow({
    width: 600,
    height: 620,
    resizable: false,
    maximizable: false,
    // This window can appear before the local engine exists, so it cannot use the app's
    // custom controls. A native frame is the only title bar that is guaranteed to work
    // here: it can always be moved and closed, even when the network is down.
    frame: true,
    center: true,
    backgroundColor: "#0b0d10",
    title: "PROOFCORE · connexion",
    icon: join(__dirname, "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  loginWindow.setMenuBarVisibility(false);
  loginWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loginPageHtml(state))}`);
  // Create this window before destroying the splash. Otherwise there is an instant with
  // zero windows, and `window-all-closed` quits the app before sign-in can even appear.
  closeSplash();
  loginWindow.on("closed", () => {
    loginWindow = null;
    // Closing the sign-in window without signing in leaves the app closed rather than open
    // in a half-state: the window is the app, and there is nothing behind it yet.
    if (!mainWindow) app.quit();
  });
  if (SMOKE) {
    process.stdout.write(`SMOKE_LOCKED reason=${state.reason}\n`);
    setTimeout(() => exitSmoke(0), 200);
  }
}

/** Writes the session in the format the CLI and its local proxy already read. */
function saveCliSession(session) {
  const path = cliSessionPath();
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(session, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

/**
 * Signs in through the site API and keeps the resulting cookie in both stores: the vault
 * for this app, and the CLI session file for the local engine that proxies the web UI.
 */
async function signIn(credentials = {}) {
  const email = typeof credentials.email === "string" ? credentials.email.trim() : "";
  const password = typeof credentials.password === "string" ? credentials.password : "";
  if (!email || !password) {
    return { allowed: false, detail: "Renseignez votre email et votre mot de passe." };
  }
  const direct = await signInWithCredentials({ apiUrl: SITE_API, email, password });
  if (!direct.ok) return { allowed: false, detail: direct.detail };
  saveCliSession(direct.session);
  store?.save(direct.session);
  log(`signed in as ${direct.session.email}`);

  const state = await gate();
  if (!state.allowed) return state;
  // Open the real window before closing the sign-in one. The login window's `closed`
  // handler quits the app when there is no main window yet; closing first made a successful
  // sign-in exit the process before the sidecar had started.
  if (!mainWindow) {
    try {
      const { port, url } = await startSidecar();
      await createWindow(port, url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox("PROOFCORE", message);
    }
  }
  if (loginWindow) {
    loginWindow.close();
    loginWindow = null;
  }
  return state;
}

/**
 * Updating the app itself.
 *
 * The sidecar updates the *engine* (`proofcore update`, checksummed, atomic). This updates
 * the *window*: electron-builder writes `latest-linux.yml`/`latest.yml` with each release, and
 * electron-updater reads it, downloads in the background and installs on quit. Two updaters
 * because they are two different files with two different lifetimes; a half-updated pair
 * would be a window that speaks a protocol the engine no longer has.
 */
/**
 * Where updates come from.
 *
 * Same host as the API the app already talks to. `PROOFCORE_API_URL` exists for a
 * self-hosted deployment; the default is the public one.
 */
const UPDATE_FEED_BASE = (
  process.env.PROOFCORE_API_URL ?? "https://proofcore-api.laudesmassamba1.workers.dev"
).replace(/\/+$/, "");

function setupAppUpdates() {
  if (!app.isPackaged || SMOKE || process.env.PROOFCORE_NO_UPDATE === "1") return;
  // electron-updater can replace an AppImage in place; a .deb is owned by the system package
  // manager. Pretending otherwise produced a permanent "check failed" on deb installs, so
  // the state says what is true and the interface offers the download page instead.
  if (process.platform === "linux" && !process.env.APPIMAGE) {
    setUpdateState({
      status: "manual",
      message: "Cette installation (.deb) se met à jour depuis la page des versions.",
    });
    return;
  }
  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch {
    log("app updater not installed in this build: engine updates only");
    return;
  }
  appUpdater = autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // The feed is our own API, not the release host: the update comes from the same place
  // the download page sends people, it works on networks that block the release host, and
  // one origin serves the window, the engine and the CLI. The Worker mirrors
  // `latest-linux.yml` / `latest.yml` / `latest-mac.yml` and the files they name.
  try {
    autoUpdater.setFeedURL({
      provider: "generic",
      url: `${UPDATE_FEED_BASE}/api/v1/releases/assets/`,
    });
  } catch (error) {
    log(`app update feed: ${error?.message ?? error}`);
  }
  autoUpdater.on("checking-for-update", () => setUpdateState({ status: "checking" }));
  autoUpdater.on("update-available", (info) => {
    log(`app update ${info.version} disponible, téléchargement`);
    setUpdateState({ status: "available", version: info.version, percent: 0 });
  });
  autoUpdater.on("update-not-available", () => setUpdateState({ status: "current" }));
  autoUpdater.on("download-progress", (progress) =>
    setUpdateState({
      status: "downloading",
      percent: Math.round(progress.percent ?? 0),
    })
  );
  autoUpdater.on("update-downloaded", (info) => {
    log(`app update ${info.version} prête`);
    // No native prompt: the Engine panel owns the update state, and the install
    // happens on quit unless the user asks for it now.
    setUpdateState({ status: "ready", version: info.version, percent: 100 });
  });
  autoUpdater.on("error", (error) => {
    log(`app update: ${error?.message ?? error}`);
    setUpdateState({ status: "error", message: error?.message ?? String(error) });
  });
  autoUpdater
    .checkForUpdates()
    .catch((error) => log(`app update check: ${error?.message ?? error}`));
}

/** Runs one sidecar command and reports its stdout; the UI renders the result. */
function runSidecar(command, args = []) {
  const resolved = sidecarCommand(sidecarPort || 7317);
  if (!resolved) return Promise.resolve("Le moteur local est introuvable dans ce build.");
  return new Promise((resolve) => {
    const child = spawn(resolved.file, [command, ...args], {
      cwd: resolved.cwd,
      env: { ...process.env, ...(resolved.env ?? {}) },
      windowsHide: true,
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("close", (code) => {
      resolve(output.trim() || `Commande terminée (code ${code ?? 0}).`);
    });
    child.on("error", (error) => resolve(String(error)));
  });
}

function aboutText() {
  return [
    `PROOFCORE ${app.getVersion()}`,
    "Le moteur tourne sur cette machine : agent, audits, bac à sable, index.",
    "Le compte, les projets, les rapports et la synchronisation passent par le site.",
    `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
  ].join("\n");
}

async function createWindow(port, url) {
  // A fixed 1180x800 is larger than the work area of a 1366x768 laptop. Size to the
  // screen instead of spilling past the taskbar, while keeping a usable minimum.
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.max(820, Math.min(1180, workArea.width - 64));
  const height = Math.max(600, Math.min(800, workArea.height - 64));
  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 820,
    minHeight: 600,
    backgroundColor: "#f3f0e8",
    show: false,
    center: true,
    frame: false,
    title: "PROOFCORE",
    icon: join(__dirname, "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.once("ready-to-show", () => {
    closeSplash();
    mainWindow.show();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Anything that is not the local engine belongs in the user's browser: a login page,
  // a documentation link, a payment page. Opening them inside the app would hide the URL
  // bar from someone who needs to check it.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://127.0.0.1:${port}`)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // The local engine listens on a fresh port at every launch. The per-run cookie is
  // scoped to 127.0.0.1 and *not* to the port, so Electron happily restores the token
  // from the previous run; that token no longer matches the new sidecar and every API
  // call answers 401. Drop only our cookie before navigating, then let the one-time URL
  // set the current token.
  for (const origin of ["http://127.0.0.1/", "http://localhost/"]) {
    await mainWindow.webContents.session.cookies.remove(origin, "pc_local").catch(() => undefined);
  }

  mainWindow.loadURL(url);

  mainWindow.webContents.on("did-finish-load", () => {
    if (SMOKE) {
      process.stdout.write(
        `SMOKE_OK title=${mainWindow.getTitle()} url=${mainWindow.webContents.getURL()}\n`
      );
      setTimeout(() => exitSmoke(0), 300);
    }
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, description) => {
    closeSplash();
    if (SMOKE) {
      process.stderr.write(`SMOKE_FAIL ${code} ${description}\n`);
      exitSmoke(1);
    } else {
      dialog.showErrorBox(
        "PROOFCORE",
        `La fenêtre n'a pas pu charger l'application (${code} ${description}).`
      );
    }
  });
}

/** Preferences that the window legitimately needs: where the engine listens, and versions. */
ipcMain.handle("proofcore:state", () => accessState);
ipcMain.handle("proofcore:login", (_event, credentials) => signIn(credentials));
ipcMain.handle("proofcore:session-updated", async () => {
  const normalized = normalizeStoredSession(readCliSession(), SITE_API);
  if (normalized) store.save(normalized);
  const session = store.load();
  return session && !session.error ? { saved: true } : { saved: false };
});
ipcMain.handle("proofcore:logout", async () => {
  store?.clear();
  const command = sidecarCommand(sidecarPort || 7317);
  if (command) {
    await new Promise((resolve) => {
      const child = spawn(command.file, ["logout"], {
        cwd: command.cwd,
        env: { ...process.env, ...(command.env ?? {}) },
        stdio: "ignore",
        windowsHide: true,
      });
      child.on("close", resolve);
      child.on("error", resolve);
    });
  }
  return { cleared: true };
});
ipcMain.handle("proofcore:open-external", (_event, url) => {
  // Only http(s): a login page must not be able to ask the shell to run a file.
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) return false;
  shell.openExternal(url);
  return true;
});

ipcMain.handle("proofcore:window", (_event, action) => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  switch (action) {
    case "minimize":
      mainWindow.minimize();
      return true;
    case "maximize":
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
      return true;
    case "close":
      mainWindow.close();
      return true;
    default:
      return false;
  }
});

ipcMain.handle("proofcore:update-state", () => updateState);
ipcMain.handle("proofcore:info", () => {
  const cores = cpus();
  return {
    port: sidecarPort,
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    cpu: cores[0]?.model?.trim() || null,
    cores: cores.length,
    memoryGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    electron: process.versions.electron,
    packaged: app.isPackaged,
    root: safeCwd(),
  };
});

/**
 * Native actions requested by the embedded UI. The UI is the only menu: this handler
 * returns text instead of opening dialogs, so results stay inside the product's design.
 */
ipcMain.handle("proofcore:action", async (_event, action) => {
  if (typeof action !== "string") return { ok: false, output: "Action invalide." };
  switch (action) {
    case "open-agent":
      if (!mainWindow || mainWindow.isDestroyed()) {
        return { ok: false, output: "La fenêtre n'est pas prête." };
      }
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send("proofcore:navigate", "/app/ai/local");
      return { ok: true, output: "Agent local ouvert." };
    case "open-console":
      // The shell console, not the assistant. They are two different pages and the menu
      // used to send both to the assistant, which is why "Console locale" never opened it.
      if (!mainWindow || mainWindow.isDestroyed()) {
        return { ok: false, output: "La fenêtre n'est pas prête." };
      }
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send("proofcore:navigate", "/app/terminal");
      return { ok: true, output: "Console locale ouverte." };
    case "tests":
      return { ok: true, output: await runSidecar("test", ["--module", "world,flow,exit"]) };
    case "doctor":
      return { ok: true, output: await runSidecar("doctor") };
    case "update":
      return { ok: true, output: await runSidecar("update", ["--yes"]) };
    case "check-app-update":
      if (!appUpdater) {
        return {
          ok: false,
          output:
            "Cette build ne contient pas le vérificateur de mise à jour. Installez une version publiée.",
        };
      }
      void appUpdater
        .checkForUpdates()
        .catch((error) => log(`app update check: ${error?.message ?? error}`));
      return { ok: true, output: "Recherche d'une mise à jour de l'application…" };
    case "install-update":
      if (!appUpdater) return { ok: false, output: "Aucune mise à jour de l'application prête." };
      setImmediate(() => appUpdater.quitAndInstall());
      return { ok: true, output: "Installation de la mise à jour…" };
    case "about":
      return { ok: true, output: aboutText() };
    case "open-site":
      await shell.openExternal("https://proofstack-iota.vercel.app");
      return { ok: true, output: "Site ouvert dans le navigateur." };
    case "open-releases":
      await shell.openExternal("https://github.com/laudesmassamba1-ai/PROOFSTACK/releases/latest");
      return { ok: true, output: "Versions ouvertes dans le navigateur." };
    case "reload":
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
      return { ok: true, output: "Interface rechargée." };
    case "quit":
      app.quit();
      return { ok: true, output: "Fermeture…" };
    default:
      return { ok: false, output: `Action inconnue : ${action}` };
  }
});

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  // No native menu bar. The product UI owns every action (see the Engine panel),
  // so the window must not open with an OS menu that breaks the site's identity.
  Menu.setApplicationMenu(null);
  nativeTheme.themeSource = "light";
  showSplash();
  try {
    const state = await gate();
    if (!state.allowed) {
      showLoginWindow(state);
      return;
    }
    const { port, url } = await startSidecar();
    await createWindow(port, url);
    setupAppUpdates();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (SMOKE) {
      process.stderr.write(`SMOKE_FAIL ${message}\n${sidecarLog.join("\n")}\n`);
      exitSmoke(1);
      return;
    }
    dialog.showErrorBox(
      "PROOFCORE n'a pas pu démarrer",
      `${message}\n\n${sidecarLog.slice(-12).join("\n") || "Aucun journal du moteur local."}`
    );
    closeSplash();
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && sidecarPort) {
    void createWindow(sidecarPort, sidecarUrl ?? `http://127.0.0.1:${sidecarPort}/`);
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
  browserHost.destroy();
  closeSplash();
  if (sidecar && !sidecar.killed) {
    sidecar.kill();
    // On Windows children do not always die with their parent; taskkill is the reliable way.
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(sidecar.pid), "/T", "/F"], { windowsHide: true });
    }
  }
});
