/**
 * The only bridge between the window and Electron.
 *
 * Nothing here exposes Node: the window is a normal web page, and the engine it talks to is
 * an HTTP server on loopback. This exists so the page can show its version and reconnect to
 * the right port after a reload, not so it can reach the filesystem.
 *
 * The `browser` group is the exception in appearance only: it drives a Chromium the main
 * process owns, through named operations. The page never receives a `webContents`, a path or
 * an IPC channel it can forge.
 */
const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("proofcoreDesktop", {
  info: () => ipcRenderer.invoke("proofcore:info"),
  state: () => ipcRenderer.invoke("proofcore:state"),
  login: (credentials) => ipcRenderer.invoke("proofcore:login", credentials),
  sessionUpdated: () => ipcRenderer.invoke("proofcore:session-updated"),
  logout: () => ipcRenderer.invoke("proofcore:logout"),
  openExternal: (url) => ipcRenderer.invoke("proofcore:open-external", String(url)),
  action: (name) => ipcRenderer.invoke("proofcore:action", String(name)),
  window: (action) => ipcRenderer.invoke("proofcore:window", String(action)),
  updateState: () => ipcRenderer.invoke("proofcore:update-state"),
  onNavigate: (callback) => {
    const handler = (_event, path) => callback(String(path));
    ipcRenderer.on("proofcore:navigate", handler);
    return () => ipcRenderer.removeListener("proofcore:navigate", handler);
  },
  onUpdate: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("proofcore:update", handler);
    return () => ipcRenderer.removeListener("proofcore:update", handler);
  },
  browser: {
    create: (payload) => ipcRenderer.invoke("proofcore:browser-create", payload ?? {}),
    state: () => ipcRenderer.invoke("proofcore:browser-state"),
    newTab: (payload) => ipcRenderer.invoke("proofcore:browser-new-tab", payload ?? {}),
    selectTab: (tabId) => ipcRenderer.invoke("proofcore:browser-select-tab", { tabId }),
    closeTab: (tabId) => ipcRenderer.invoke("proofcore:browser-close-tab", { tabId }),
    navigate: (url) => ipcRenderer.invoke("proofcore:browser-navigate", { url }),
    back: () => ipcRenderer.invoke("proofcore:browser-back"),
    forward: () => ipcRenderer.invoke("proofcore:browser-forward"),
    reload: () => ipcRenderer.invoke("proofcore:browser-reload"),
    stop: () => ipcRenderer.invoke("proofcore:browser-stop"),
    setBounds: (bounds) => ipcRenderer.invoke("proofcore:browser-set-bounds", bounds),
    setVisible: (visible) => ipcRenderer.invoke("proofcore:browser-set-visible", { visible }),
    find: (text, options) =>
      ipcRenderer.invoke("proofcore:browser-find", { text, ...(options ?? {}) }),
    findStop: () => ipcRenderer.invoke("proofcore:browser-find-stop"),
    zoom: (delta, reset) => ipcRenderer.invoke("proofcore:browser-zoom", { delta, reset }),
    devtools: () => ipcRenderer.invoke("proofcore:browser-devtools"),
    external: (url) => ipcRenderer.invoke("proofcore:browser-external", { url }),
    destroy: () => ipcRenderer.invoke("proofcore:browser-destroy"),
    onState: (callback) => subscribe("proofcore:browser-state", callback),
    onError: (callback) => subscribe("proofcore:browser-error", callback),
    onDownload: (callback) => subscribe("proofcore:browser-download", callback),
    onWarning: (callback) => subscribe("proofcore:browser-warning", callback),
    onFocusAddress: (callback) => subscribe("proofcore:browser-focus-address", callback),
    onFocusFind: (callback) => subscribe("proofcore:browser-focus-find", callback),
  },
  isDesktop: true,
});
