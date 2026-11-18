/**
 * The desktop application.
 *
 * Two processes, on purpose:
 *
 * - this one (Electron) draws the window, owns the menus and the lifecycle;
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
  Menu,
  dialog,
  shell,
  ipcMain,
  nativeTheme,
  safeStorage,
  net,
} = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { createServer } = require("node:net");
const { join } = require("node:path");
const { homedir } = require("node:os");
const { chmodSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { evaluateAccess, formatRemaining } = require("./src/access.cjs");
const { createStore } = require("./src/store.cjs");
const { loginPageHtml } = require("./src/login-page.cjs");

const SMOKE = process.env.PROOFCORE_SMOKE === "1";
const SITE_API =
  process.env.PROOFCORE_API_URL ?? "https://proofcore-api.laudesmassamba1.workers.dev";

/** One window, one sidecar: a second launch focuses the first instead of starting another. */
if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow = null;
let loginWindow = null;
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

function log(line) {
  sidecarLog.push(line);
  if (sidecarLog.length > 400) sidecarLog.shift();
  if (!app.isPackaged || SMOKE) process.stdout.write(`[sidecar] ${line}\n`);
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
    if (fromCli) {
      store.save(fromCli);
      session = fromCli;
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
    width: 580,
    height: 520,
    resizable: false,
    maximizable: false,
    backgroundColor: "#0b0d10",
    title: "PROOFCORE · connexion",
    icon: join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  loginWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loginPageHtml(state))}`);
  loginWindow.on("closed", () => {
    loginWindow = null;
    // Closing the sign-in window without signing in leaves the app closed rather than open
    // in a half-state: the window is the app, and there is nothing behind it yet.
    if (!mainWindow) app.quit();
  });
  if (SMOKE) {
    process.stdout.write(`SMOKE_LOCKED reason=${state.reason}\n`);
    setTimeout(() => app.exit(0), 200);
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
  let response;
  try {
    response = await fetch(`${SITE_API.replace(/\/+$/, "")}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    return {
      allowed: false,
      detail: `Le site est injoignable : ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const text = await response.text();
  if (!response.ok) {
    let detail = `Connexion refusée (HTTP ${response.status}).`;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error?.message) detail = parsed.error.message;
    } catch {
      // The status is enough when the site did not return its JSON envelope.
    }
    return { allowed: false, detail };
  }
  const rawCookie =
    response.headers.getSetCookie?.()[0] ?? response.headers.get("set-cookie") ?? "";
  const cookie = rawCookie.split(";")[0];
  if (!cookie.startsWith("ps_session=")) {
    return { allowed: false, detail: "Le site a accepté la connexion sans renvoyer de session." };
  }
  let account = email;
  try {
    const parsed = JSON.parse(text);
    if (parsed?.user?.email) account = parsed.user.email;
  } catch {
    // The cookie is what matters; the email is a display hint.
  }
  const session = { apiUrl: SITE_API, cookie, email: account, savedAt: new Date().toISOString() };
  saveCliSession(session);
  store?.save(session);
  log(`signed in as ${account}`);

  const state = await gate();
  if (!state.allowed) return state;
  // Open the real window before closing the sign-in one. The login window's `closed`
  // handler quits the app when there is no main window yet; closing first made a successful
  // sign-in exit the process before the sidecar had started.
  if (!mainWindow) {
    try {
      const { port, url } = await startSidecar();
      buildMenu();
      createWindow(port, url);
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
function setupAppUpdates() {
  if (!app.isPackaged || SMOKE || process.env.PROOFCORE_NO_UPDATE === "1") return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch {
    log("app updater not installed in this build: engine updates only");
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", (info) =>
    log(`app update ${info.version} disponible, téléchargement`)
  );
  autoUpdater.on("update-downloaded", (info) => {
    log(`app update ${info.version} prête`);
    if (!mainWindow) return;
    dialog
      .showMessageBox(mainWindow, {
        message: `PROOFCORE ${info.version} est prête`,
        detail: "Elle s'installera à la fermeture, ou maintenant si vous préférez.",
        buttons: ["Installer maintenant", "Plus tard"],
        defaultId: 0,
        cancelId: 1,
      })
      .then((answer) => {
        if (answer.response === 0) autoUpdater.quitAndInstall();
      })
      .catch(() => undefined);
  });
  autoUpdater.on("error", (error) => log(`app update: ${error?.message ?? error}`));
  autoUpdater
    .checkForUpdates()
    .catch((error) => log(`app update check: ${error?.message ?? error}`));
}

function buildMenu() {
  const account = () =>
    spawnSidecarOnce("whoami", [], (text) => {
      dialog.showMessageBox(mainWindow, {
        message: text || "Aucun compte connecté.",
        buttons: ["Fermer"],
      });
    });

  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    {
      label: "PROOFCORE",
      submenu: [
        { label: "À propos", click: () => showAbout() },
        { type: "separator" },
        {
          label: "Se connecter…",
          click: () =>
            spawnSidecarOnce("login", [], (text) => {
              if (text) dialog.showMessageBox(mainWindow, { message: text, buttons: ["Fermer"] });
              if (mainWindow) mainWindow.webContents.reload();
            }),
        },
        { label: "Mon compte", click: () => account() },
        { type: "separator" },
        {
          label: accessState?.account
            ? `Session : ${accessState.account} (${formatRemaining((accessState.expiresAt ?? 0) - Date.now())})`
            : "Session : non connecté",
          enabled: false,
        },
        ...(accessState?.status === "offline"
          ? [{ label: "Hors ligne : outils locaux disponibles", enabled: false }]
          : []),
        { type: "separator" },
        {
          label: "Se déconnecter",
          click: async () => {
            store?.clear();
            await dialog.showMessageBox(mainWindow ?? loginWindow, {
              message: "Session supprimée sur cette machine.",
              detail: "Relancez PROOFCORE pour vous reconnecter.",
              buttons: ["Fermer"],
            });
          },
        },
        {
          label: "Ouvrir le site",
          click: () => shell.openExternal("https://proofstack-iota.vercel.app"),
        },
        { type: "separator" },
        { label: "Mettre à jour…", click: () => runUpdate() },
        { label: "Ouvrir la console locale", click: () => openLocalAgent() },
        { label: "Lancer les tests locaux", click: () => runLocalTests() },
        { label: "Vérifier les conflits (doctor)", click: () => runDoctor() },
        { type: "separator" },
        { role: process.platform === "darwin" ? "close" : "quit", label: "Quitter" },
      ],
    },
    { role: "editMenu" },
    {
      label: "Affichage",
      submenu: [
        { role: "reload", label: "Recharger" },
        { role: "toggleDevTools", label: "Outils de développement" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Runs one sidecar command and reports its stdout; used by the menu, not by the UI. */
function spawnSidecarOnce(command, args, done) {
  const resolved = sidecarCommand(sidecarPort || 7317);
  if (!resolved) return done("Le moteur local est introuvable dans ce build.");
  const child = spawn(resolved.file, [...(resolved.env ? [] : [])].concat([command, ...args]), {
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
  child.on("close", () => done(output.trim()));
  child.on("error", (error) => done(String(error)));
}

function openLocalAgent() {
  if (!sidecarPort) return;
  const window = new BrowserWindow({
    width: 980,
    height: 760,
    backgroundColor: "#0b0d10",
    title: "PROOFCORE · console locale",
    icon: join(__dirname, "build", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.loadURL(`http://127.0.0.1:${sidecarPort}/agent`);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${sidecarPort}`)) shell.openExternal(url);
    return { action: "deny" };
  });
}

function showSidecarOutput(title, text) {
  const window = new BrowserWindow({
    width: 980,
    height: 700,
    backgroundColor: "#0b0d10",
    title: `PROOFCORE · ${title}`,
    parent: mainWindow ?? undefined,
  });
  const body = `<pre style="margin:0;padding:16px;font:12.5px/1.5 ui-monospace,monospace;color:#e8ecf1;background:#0b0d10;white-space:pre-wrap">${text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")}</pre>`;
  window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(body)}`);
}

function runDoctor() {
  spawnSidecarOnce("doctor", [], (text) => showSidecarOutput("doctor", text));
}

function runLocalTests() {
  spawnSidecarOnce("test", ["--module", "world,flow,exit"], (text) =>
    showSidecarOutput("tests locaux", text)
  );
}

async function runUpdate() {
  // The sidecar owns the update: it knows this platform, verifies the checksum and swaps the
  // binary. The window only reports what happened.
  const answer = await dialog.showMessageBox(mainWindow, {
    type: "question",
    message: "Vérifier les mises à jour ?",
    detail:
      "Le moteur local lit le manifeste de la dernière version et remplace son binaire s'il y en a une.",
    buttons: ["Vérifier", "Annuler"],
    defaultId: 0,
    cancelId: 1,
  });
  if (answer.response !== 0) return;
  spawnSidecarOnce("update", ["--yes"], (text) => {
    dialog.showMessageBox(mainWindow, {
      message: "Mise à jour",
      detail: text || "Aucune sortie.",
      buttons: ["Fermer"],
    });
  });
}

function showAbout() {
  const version = app.getVersion();
  dialog.showMessageBox(mainWindow, {
    message: `PROOFCORE ${version}`,
    detail: [
      "Le moteur tourne sur cette machine : agent, audits, bac à sable, index.",
      "Le compte, les projets, les rapports et la synchronisation passent par le site.",
      `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
    ].join("\n"),
    buttons: ["Fermer"],
  });
}

function createWindow(port, url) {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0b0d10",
    show: false,
    title: "PROOFCORE",
    icon: join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
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

  mainWindow.loadURL(url);

  mainWindow.webContents.on("did-finish-load", () => {
    if (SMOKE) {
      process.stdout.write(
        `SMOKE_OK title=${mainWindow.getTitle()} url=${mainWindow.webContents.getURL()}\n`
      );
      setTimeout(() => app.exit(0), 300);
    }
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, description) => {
    if (SMOKE) {
      process.stderr.write(`SMOKE_FAIL ${code} ${description}\n`);
      app.exit(1);
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
  const fromCli = readCliSession();
  if (fromCli) store.save(fromCli);
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

ipcMain.handle("proofcore:info", () => ({
  port: sidecarPort,
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
}));

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  nativeTheme.themeSource = "dark";
  try {
    const state = await gate();
    if (!state.allowed) {
      buildMenu();
      showLoginWindow(state);
      return;
    }
    const { port, url } = await startSidecar();
    buildMenu();
    createWindow(port, url);
    setupAppUpdates();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (SMOKE) {
      process.stderr.write(`SMOKE_FAIL ${message}\n${sidecarLog.join("\n")}\n`);
      app.exit(1);
      return;
    }
    dialog.showErrorBox(
      "PROOFCORE n'a pas pu démarrer",
      `${message}\n\n${sidecarLog.slice(-12).join("\n") || "Aucun journal du moteur local."}`
    );
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && sidecarPort) {
    createWindow(sidecarPort, sidecarUrl ?? `http://127.0.0.1:${sidecarPort}/`);
  }
});

app.on("before-quit", () => {
  app.isQuitting = true;
  if (sidecar && !sidecar.killed) {
    sidecar.kill();
    // On Windows children do not always die with their parent; taskkill is the reliable way.
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(sidecar.pid), "/T", "/F"], { windowsHide: true });
    }
  }
});
