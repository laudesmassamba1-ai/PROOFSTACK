/**
 * The small surface the native window adds to the web app.
 *
 * The page remains a normal web page: no Node, no filesystem. This only lets the local
 * shell copy a session it just received from the site into its vault, and clear that vault
 * on sign-out. Everything else goes through the local bridge's HTTP proxy.
 */
export {};

declare global {
  interface Window {
    proofcoreDesktop?: {
      isDesktop: true;
      info: () => Promise<{
        port: number;
        version: string;
        platform: string;
        arch: string;
        cpu: string | null;
        cores: number;
        memoryGb: number;
        electron: string;
        packaged: boolean;
        root: string;
      }>;
      state: () => Promise<unknown>;
      login: (credentials: { email: string; password: string }) => Promise<{
        allowed?: boolean;
        detail?: string;
      }>;
      sessionUpdated: () => Promise<{ saved: boolean }>;
      logout: () => Promise<{ cleared: boolean }>;
      openExternal: (url: string) => Promise<boolean>;
      action: (
        name:
          | "open-agent"
          | "open-console"
          | "tests"
          | "doctor"
          | "update"
          | "check-app-update"
          | "install-update"
          | "about"
          | "open-site"
          | "open-releases"
          | "reload"
          | "quit"
      ) => Promise<{ ok: boolean; output: string }>;
      window: (action: "minimize" | "maximize" | "close") => Promise<boolean>;
      updateState: () => Promise<UpdateState>;
      onUpdate: (callback: (state: UpdateState) => void) => () => void;
      onNavigate: (callback: (path: string) => void) => () => void;
      /**
       * The embedded Chromium browser. Present only in the desktop application; a page
       * without it falls back to the server-rendered preview.
       */
      browser?: DesktopBrowser;
    };
  }

  interface DesktopBrowserTab {
    id: string;
    url: string;
    title: string;
    loading: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
  }

  interface DesktopBrowserState {
    open: boolean;
    activeTabId: string | null;
    tabs: DesktopBrowserTab[];
    find: { active: boolean; text: string; matches: number; activeMatch: number };
  }

  interface DesktopBrowser {
    create: (payload: { url?: string }) => Promise<DesktopBrowserState>;
    state: () => Promise<DesktopBrowserState>;
    newTab: (payload?: { url?: string }) => Promise<DesktopBrowserState>;
    selectTab: (tabId: string) => Promise<DesktopBrowserState>;
    closeTab: (tabId: string) => Promise<DesktopBrowserState>;
    navigate: (url: string) => Promise<DesktopBrowserState>;
    back: () => Promise<DesktopBrowserState>;
    forward: () => Promise<DesktopBrowserState>;
    reload: () => Promise<DesktopBrowserState>;
    stop: () => Promise<DesktopBrowserState>;
    setBounds: (bounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    }) => Promise<boolean>;
    setVisible: (visible: boolean) => Promise<boolean>;
    find: (
      text: string,
      options?: { forward?: boolean; findNext?: boolean }
    ) => Promise<DesktopBrowserState["find"]>;
    findStop: () => Promise<unknown>;
    zoom: (delta?: number, reset?: boolean) => Promise<number>;
    devtools: () => Promise<boolean>;
    external: (url: string) => Promise<boolean>;
    destroy: () => Promise<boolean>;
    onState: (callback: (state: DesktopBrowserState) => void) => () => void;
    onError: (callback: (payload: { description: string; url?: string }) => void) => () => void;
    onDownload: (callback: (payload: { filename: string; state: string }) => void) => () => void;
    onFocusAddress: (callback: () => void) => () => void;
    onFocusFind: (callback: () => void) => () => void;
  }

  interface UpdateState {
    status:
      | "idle"
      | "checking"
      | "available"
      | "downloading"
      | "ready"
      | "current"
      | "manual"
      | "error";
    version: string | null;
    percent: number;
    message: string | null;
  }
}
