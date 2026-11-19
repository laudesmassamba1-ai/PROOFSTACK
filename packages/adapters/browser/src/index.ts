/**
 * PROOFCORE's browser engine.
 *
 * A Chromium the machine already has, driven over the DevTools Protocol with no automation
 * framework, no downloaded browser and no rendering service. It provides three things the
 * product needs and keeps them separable:
 *
 * - `findChromium` / `launchBrowser`: locate and start (or attach to) a browser.
 * - `BrowserPage`: navigate, inspect, click, type, evaluate, screenshot — as a real user.
 * - `fetchReadable`: read a page's server response when launching a browser would be waste.
 *
 * The desktop application goes one step further: it embeds a Chromium view directly, so the
 * panel is a real browser with native input, not a stream of screenshots.
 */

export { browserWebSocketUrl, CdpConnection, CdpError, type CdpEvent } from "./cdp.js";
export {
  type ChromiumDiscoveryOptions,
  type ChromiumLookup,
  chromiumMissingMessage,
  findChromium,
} from "./discovery.js";
export {
  type LaunchedBrowser,
  type LaunchOptions,
  launchBrowser,
} from "./launch.js";
export {
  BrowserManager,
  type BrowserPageSummary,
  browsers,
  type OpenPageOptions,
} from "./manager.js";
export {
  buildResolveExpression,
  buildSetValueExpression,
  buildSnapshotExpression,
  KEY_MAP,
  type PageSnapshot,
  type SnapshotElement,
  type SnapshotOptions,
} from "./page-script.js";
export {
  decodeEntities,
  extractDescription,
  extractHeadings,
  extractLinks,
  extractTitle,
  type FetchReadableOptions,
  fetchReadable,
  htmlToMarkdown,
  htmlToText,
  type ReadablePage,
} from "./reader.js";
export {
  BrowserPage,
  type ConsoleEntry,
  type InteractionTarget,
  type InteractiveState,
  type NetworkEntry,
  normalizeBrowserUrl,
  type PageState,
} from "./session.js";
