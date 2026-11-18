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
  isDesktop: true,
});
