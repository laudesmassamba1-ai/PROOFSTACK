/**
 * The in-app browser.
 *
 * Electron *is* Chromium: the same engine that draws the application can draw a web page,
 * with real input, real cookies, real JavaScript and no network hop to a rendering service.
 * The page is a `WebContentsView` laid over the window's content area, at the rectangle the
 * interface reserves for it.
 *
 * That is the whole design. It has three properties worth stating because they are the
 * reason this file exists instead of a screenshot protocol:
 *
 * - **No extra engine.** Nothing is downloaded, no service is called, no automation
 *   framework is installed. The browser the user already has is the one being used.
 * - **Native input.** A click, a scroll, a keystroke and a drag go to the page directly.
 *   There is no coordinate mapping to drift, and no latency between the pointer and the page.
 * - **Contained.** The view has its own persistent partition, no Node integration, no
 *   preload script. A page cannot reach the application's bridge, and the site's cookies do
 *   not follow the agent into an arbitrary page.
 *
 * The renderer owns the chrome — tabs, address bar, find bar — and pushes the rectangle it
 * reserved. Everything the page does is reported back as a state event, so the interface
 * never has to guess whether a navigation finished.
 */

const { randomUUID } = require("node:crypto");

const PARTITION = "persist:proofcore-browser";
const MAX_TABS = 12;
const DEFAULT_URL = "https://example.com";

/** Adds https:// to a bare host, and refuses the scheme that turns an address into code. */
function normalizeUrl(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return DEFAULT_URL;
  if (/^javascript:/i.test(trimmed) || /^vbscript:/i.test(trimmed)) {
    throw new Error("javascript: and vbscript: addresses are refused.");
  }
  if (/^(https?|file|data|about):/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function createBrowserHost({ app, WebContentsView, shell, session, getWindow, send }) {
  /** @type {Map<string, { view: any, id: string }>} */
  const tabs = new Map();
  let order = [];
  let activeId = null;
  let bounds = { x: 0, y: 0, width: 0, height: 0 };
  let visible = false;
  let attached = null;
  let findState = { active: false, text: "", matches: 0, activeMatch: 0 };
  let permissionsConfigured = false;

  function window() {
    const win = getWindow();
    return win && !win.isDestroyed() ? win : null;
  }

  function tab() {
    return activeId ? (tabs.get(activeId) ?? null) : null;
  }

  function tabLabel(entry) {
    const webContents = entry.view.webContents;
    let url = "";
    try {
      url = webContents.getURL();
    } catch {
      url = "";
    }
    let title = "";
    try {
      title = webContents.getTitle() ?? "";
    } catch {
      title = "";
    }
    return {
      id: entry.id,
      url,
      title,
      loading: webContents.isLoading(),
      canGoBack: webContents.canGoBack ? webContents.canGoBack() : false,
      canGoForward: webContents.canGoForward ? webContents.canGoForward() : false,
    };
  }

  function state() {
    return {
      open: tabs.size > 0,
      activeTabId: activeId,
      tabs: order
        .map((id) => tabs.get(id))
        .filter(Boolean)
        .map(tabLabel),
      bounds,
      visible,
      find: findState,
      partition: PARTITION,
    };
  }

  function publish() {
    send("proofcore:browser-state", state());
  }

  function configurePermissions() {
    if (permissionsConfigured) return;
    permissionsConfigured = true;
    try {
      const partition = session.fromPartition(PARTITION);
      // A page the agent opened has no reason to reach the camera, the microphone or the
      // clipboard unsolicited. Fullscreen and self-initiated clipboard writes are normal
      // web behaviour and stay allowed; everything else is denied, not silently granted.
      const allowed = new Set(["fullscreen", "clipboard-sanitized-write"]);
      partition.setPermissionRequestHandler((_webContents, permission, callback) => {
        callback(allowed.has(permission));
      });
      partition.setPermissionCheckHandler((_webContents, permission) => allowed.has(permission));
      partition.on("will-download", (_event, item) => {
        send("proofcore:browser-download", {
          filename: item.getFilename(),
          bytes: item.getTotalBytes(),
          state: "started",
        });
        item.once("done", (_doneEvent, status) => {
          send("proofcore:browser-download", {
            filename: item.getFilename(),
            state: status,
            path: item.getSavePath() || null,
          });
        });
      });
    } catch (error) {
      // A missing partition API must not stop the browser from opening; it only means the
      // permissions fall back to Electron's defaults.
      send("proofcore:browser-warning", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function layout() {
    const win = window();
    const entry = tab();
    if (!win || !entry) return;
    const view = entry.view;
    const width = Math.max(0, Math.round(bounds.width));
    const height = Math.max(0, Math.round(bounds.height));
    const show = visible && width > 8 && height > 8;

    try {
      if (show) {
        if (attached !== view) {
          if (attached) win.contentView.removeChildView(attached);
          win.contentView.addChildView(view);
          attached = view;
        }
        view.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width, height });
        try {
          view.setVisible(true);
        } catch {
          // No setVisible on this build: being attached is already visible.
        }
      } else if (attached === view) {
        let hidden = false;
        try {
          view.setVisible(false);
          hidden = true;
        } catch {
          hidden = false;
        }
        if (!hidden) {
          // Hiding is not optional: a page left over the interface cannot be clicked
          // through. Removing the view from the window is the older, portable equivalent.
          win.contentView.removeChildView(view);
          attached = null;
        }
      }
    } catch {
      // A destroyed window or view is a normal race during a reload; the next event fixes it.
    }
  }

  function activate(id) {
    if (!tabs.has(id)) return;
    const previous = tab();
    activeId = id;
    const win = window();
    if (win && previous && previous.id !== id) {
      // Detach the previous page: only one tab is ever laid over the window.
      try {
        win.contentView.removeChildView(previous.view);
      } catch {
        // Already detached.
      }
      attached = null;
    }
    layout();
    publish();
    const entry = tab();
    if (entry) {
      try {
        entry.view.webContents.focus();
      } catch {
        // Not focusable yet.
      }
    }
  }

  function addTab(rawUrl, options = {}) {
    const win = window();
    if (!win) throw new Error("The window is not ready.");
    if (tabs.size >= MAX_TABS) {
      throw new Error(`This browser is limited to ${MAX_TABS} tabs.`);
    }
    configurePermissions();
    const id = `tab-${randomUUID().slice(0, 8)}`;
    const view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        spellcheck: true,
      },
    });
    try {
      view.setBackgroundColor("#ffffff");
    } catch {
      // Older builds do not expose it; the window background is white anyway.
    }
    const webContents = view.webContents;

    // A link with target=_blank belongs in this browser, as a new tab — not in the user's
    // external browser, and not in a popup with no address bar.
    webContents.setWindowOpenHandler(({ url }) => {
      try {
        addTab(url);
      } catch {
        // At the tab limit, refuse the popup rather than replacing the current page.
      }
      return { action: "deny" };
    });

    const emit = () => publish();
    webContents.on("did-start-loading", emit);
    webContents.on("did-stop-loading", () => {
      findState = { active: false, text: "", matches: 0, activeMatch: 0 };
      emit();
    });
    webContents.on("did-navigate", emit);
    webContents.on("did-navigate-in-page", emit);
    webContents.on("page-title-updated", emit);
    webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame) return;
      send("proofcore:browser-error", { tabId: id, code, description, url });
      emit();
    });
    webContents.on("render-process-gone", (_event, details) => {
      send("proofcore:browser-error", {
        tabId: id,
        code: "render-process-gone",
        description: details.reason,
        url: webContents.getURL(),
      });
    });
    webContents.on("will-navigate", (event, url) => {
      try {
        normalizeUrl(url);
      } catch {
        event.preventDefault();
      }
    });
    webContents.on("found-in-page", (_event, result) => {
      findState = {
        active: true,
        text: findState.text,
        matches: result.matches ?? 0,
        activeMatch: result.activeMatchOrdinal ?? 0,
      };
      publish();
    });
    webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const modifier = process.platform === "darwin" ? input.meta : input.control;
      const key = input.key.toLowerCase();
      const handled = () => event.preventDefault();
      if (modifier && key === "l") {
        handled();
        send("proofcore:browser-focus-address", { tabId: id });
        return;
      }
      if (modifier && key === "t") {
        handled();
        try {
          addTab("about:blank");
        } catch {
          // Tab limit.
        }
        return;
      }
      if (modifier && key === "w") {
        handled();
        closeTab(id);
        return;
      }
      if (modifier && key === "f") {
        handled();
        send("proofcore:browser-focus-find", { tabId: id });
        return;
      }
      if ((modifier && key === "r") || key === "f5") {
        handled();
        webContents.reload();
        return;
      }
      if (key === "f12" || (modifier && input.shift && key === "i")) {
        handled();
        toggleDevtools();
        return;
      }
      if (input.alt && key === "left") {
        handled();
        if (webContents.canGoBack()) webContents.goBack();
        return;
      }
      if (input.alt && key === "right") {
        handled();
        if (webContents.canGoForward()) webContents.goForward();
        return;
      }
      if (modifier && (key === "=" || key === "+")) {
        handled();
        webContents.setZoomLevel(Math.min(webContents.getZoomLevel() + 0.5, 4));
        return;
      }
      if (modifier && key === "-") {
        handled();
        webContents.setZoomLevel(Math.max(webContents.getZoomLevel() - 0.5, -3));
        return;
      }
      if (modifier && key === "0") {
        handled();
        webContents.setZoomLevel(0);
        return;
      }
      if (key === "escape" && findState.active) {
        stopFind();
      }
    });

    tabs.set(id, { view, id });
    order = [...order, id];
    activate(id);
    const target = options.blank ? "about:blank" : normalizeUrl(rawUrl);
    webContents.loadURL(target).catch((error) => {
      send("proofcore:browser-error", {
        tabId: id,
        code: "navigation_failed",
        description: error instanceof Error ? error.message : String(error),
        url: target,
      });
    });
    return id;
  }

  function closeTab(id) {
    const entry = id ? tabs.get(id) : tab();
    if (!entry) return;
    const win = window();
    if (win) {
      try {
        win.contentView.removeChildView(entry.view);
      } catch {
        // Already gone.
      }
    }
    if (attached === entry.view) attached = null;
    tabs.delete(entry.id);
    order = order.filter((tabId) => tabId !== entry.id);
    try {
      entry.view.webContents.close();
    } catch {
      // The page is already destroyed.
    }
    if (activeId === entry.id) {
      const next = order[order.length - 1] ?? null;
      activeId = null;
      if (next) activate(next);
      else {
        visible = false;
        publish();
      }
    } else {
      publish();
    }
  }

  function activeWebContents() {
    return tab()?.view.webContents ?? null;
  }

  function openDevtools() {
    const webContents = activeWebContents();
    if (!webContents) return false;
    if (webContents.isDevToolsOpened()) webContents.closeDevTools();
    else webContents.openDevTools({ mode: "detach" });
    return true;
  }

  function toggleDevtools() {
    openDevtools();
  }

  function find(text, options = {}) {
    const webContents = activeWebContents();
    if (!webContents) return;
    const query = String(text ?? "");
    if (!query) {
      stopFind();
      return;
    }
    findState = { ...findState, active: true, text: query };
    webContents.findInPage(query, {
      forward: options.forward !== false,
      findNext: options.findNext === true,
    });
  }

  function stopFind() {
    const webContents = activeWebContents();
    if (webContents) webContents.stopFindInPage("clearSelection");
    findState = { active: false, text: "", matches: 0, activeMatch: 0 };
    publish();
  }

  function destroy() {
    for (const id of [...tabs.keys()]) {
      const entry = tabs.get(id);
      if (!entry) continue;
      const win = window();
      if (win) {
        try {
          win.contentView.removeChildView(entry.view);
        } catch {
          // Already detached.
        }
      }
      try {
        entry.view.webContents.close();
      } catch {
        // Already destroyed.
      }
    }
    tabs.clear();
    order = [];
    activeId = null;
    attached = null;
    visible = false;
  }

  function register(ipcMain) {
    ipcMain.handle("proofcore:browser-create", (_event, payload = {}) => {
      if (tabs.size === 0) addTab(payload.url || DEFAULT_URL, { blank: !payload.url });
      else activate(order[order.length - 1]);
      if (payload.bounds) {
        bounds = {
          x: Number(payload.bounds.x) || 0,
          y: Number(payload.bounds.y) || 0,
          width: Number(payload.bounds.width) || 0,
          height: Number(payload.bounds.height) || 0,
        };
      }
      visible = true;
      layout();
      publish();
      return state();
    });
    ipcMain.handle("proofcore:browser-state", () => state());
    ipcMain.handle("proofcore:browser-new-tab", (_event, payload = {}) => {
      addTab(payload.url || "about:blank", { blank: !payload.url });
      return state();
    });
    ipcMain.handle("proofcore:browser-select-tab", (_event, payload = {}) => {
      if (payload.tabId) activate(String(payload.tabId));
      return state();
    });
    ipcMain.handle("proofcore:browser-close-tab", (_event, payload = {}) => {
      closeTab(payload.tabId ? String(payload.tabId) : undefined);
      return state();
    });
    ipcMain.handle("proofcore:browser-navigate", (_event, payload = {}) => {
      const webContents = activeWebContents();
      if (!webContents) return state();
      const url = normalizeUrl(payload.url);
      webContents.loadURL(url).catch((error) => {
        send("proofcore:browser-error", {
          code: "navigation_failed",
          description: error instanceof Error ? error.message : String(error),
          url,
        });
      });
      return state();
    });
    ipcMain.handle("proofcore:browser-back", () => {
      const webContents = activeWebContents();
      if (webContents?.canGoBack()) webContents.goBack();
      return state();
    });
    ipcMain.handle("proofcore:browser-forward", () => {
      const webContents = activeWebContents();
      if (webContents?.canGoForward()) webContents.goForward();
      return state();
    });
    ipcMain.handle("proofcore:browser-reload", () => {
      activeWebContents()?.reload();
      return state();
    });
    ipcMain.handle("proofcore:browser-stop", () => {
      activeWebContents()?.stop();
      return state();
    });
    ipcMain.handle("proofcore:browser-set-bounds", (_event, payload = {}) => {
      bounds = {
        x: Number(payload.x) || 0,
        y: Number(payload.y) || 0,
        width: Math.max(0, Number(payload.width) || 0),
        height: Math.max(0, Number(payload.height) || 0),
      };
      layout();
      return true;
    });
    ipcMain.handle("proofcore:browser-set-visible", (_event, payload = {}) => {
      visible = payload.visible !== false;
      layout();
      publish();
      return true;
    });
    ipcMain.handle("proofcore:browser-find", (_event, payload = {}) => {
      find(payload.text, {
        forward: payload.forward !== false,
        findNext: payload.findNext === true,
      });
      return findState;
    });
    ipcMain.handle("proofcore:browser-find-stop", () => {
      stopFind();
      return findState;
    });
    ipcMain.handle("proofcore:browser-zoom", (_event, payload = {}) => {
      const webContents = activeWebContents();
      if (!webContents) return 0;
      const delta = Number(payload.delta) || 0;
      const reset = payload.reset === true;
      const level = reset ? 0 : Math.min(Math.max(webContents.getZoomLevel() + delta, -3), 4);
      webContents.setZoomLevel(level);
      publish();
      return level;
    });
    ipcMain.handle("proofcore:browser-devtools", () => openDevtools());
    ipcMain.handle("proofcore:browser-external", (_event, payload = {}) => {
      const url = String(payload.url ?? "");
      if (!/^https?:\/\//.test(url)) return false;
      shell.openExternal(url);
      return true;
    });
    ipcMain.handle("proofcore:browser-destroy", () => {
      destroy();
      return true;
    });
  }

  // A closed window takes its views with it; releasing the map lets a new window start clean.
  app.on("browser-window-created", (_event, win) => {
    win.on("closed", () => {
      if (win === getWindow()) destroy();
    });
  });

  return { register, destroy, state };
}

module.exports = { createBrowserHost, normalizeUrl, PARTITION, DEFAULT_URL };
