/**
 * The only bridge between the window and Electron.
 *
 * Nothing here exposes Node: the window is a normal web page, and the engine it talks to is
 * an HTTP server on loopback. This exists so the page can show its version and reconnect to
 * the right port after a reload, not so it can reach the filesystem.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("proofcoreDesktop", {
  info: () => ipcRenderer.invoke("proofcore:info"),
  state: () => ipcRenderer.invoke("proofcore:state"),
  login: () => ipcRenderer.invoke("proofcore:login"),
  logout: () => ipcRenderer.invoke("proofcore:logout"),
  openExternal: (url) => ipcRenderer.invoke("proofcore:open-external", String(url)),
  isDesktop: true,
});
