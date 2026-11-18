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
      }>;
      state: () => Promise<unknown>;
      login: (credentials: { email: string; password: string }) => Promise<{
        allowed?: boolean;
        detail?: string;
      }>;
      sessionUpdated: () => Promise<{ saved: boolean }>;
      logout: () => Promise<{ cleared: boolean }>;
      openExternal: (url: string) => Promise<boolean>;
    };
  }
}
