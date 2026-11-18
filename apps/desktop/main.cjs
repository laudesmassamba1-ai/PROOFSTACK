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

const { app, BrowserWindow, Menu, dialog, shell, ipcMain, nativeTheme } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { createServer } = require("node:net");
const { join } = require("node:path");

const SMOKE = process.env.PROOFCORE_SMOKE === "1";

/** One window, one sidecar: a second launch focuses the first instead of starting another. */
if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow = null;
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

  sidecar = spawn(command.file, command.args, {
    cwd: command.cwd,
    env: { ...process.env, ...(command.env ?? {}), PROOFCORE_APP: "1" },
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
        {
          label: "Ouvrir le site",
          click: () => shell.openExternal("https://proofstack-iota.vercel.app"),
        },
        { type: "separator" },
        { label: "Mettre à jour…", click: () => runUpdate() },
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

function runDoctor() {
  spawnSidecarOnce("doctor", [], (text) => {
    const window = new BrowserWindow({
      width: 980,
      height: 700,
      backgroundColor: "#0b0d10",
      title: "PROOFCORE · doctor",
      parent: mainWindow ?? undefined,
    });
    const body = `<pre style="margin:0;padding:16px;font:12.5px/1.5 ui-monospace,monospace;color:#e8ecf1;background:#0b0d10;white-space:pre-wrap">${text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")}</pre>`;
    window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(body)}`);
  });
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
    const { port, url } = await startSidecar();
    buildMenu();
    createWindow(port, url);
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
