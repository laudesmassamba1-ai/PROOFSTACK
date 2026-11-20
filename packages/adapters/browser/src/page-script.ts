/// <reference lib="dom" />
/**
 * The page snapshot, as the model receives it.
 *
 * A screenshot is not readable by a text model, and raw `outerHTML` is tens of thousands of
 * tokens of framework noise. What an agent actually needs is the page as a person perceives
 * it: visible text, headings, links, and the controls it can act on — each with a stable
 * reference it can pass back to `browser_interact`.
 *
 * The function below runs *inside* the page (`Runtime.evaluate`), so it is deliberately
 * self-contained: no imports, no closures, no helpers from this module. It tags interactive
 * elements with `data-pc-ref` and returns a JSON-safe object; the tag is what makes a click
 * or a type unambiguous afterwards, without inventing CSS selectors that break on the next
 * render.
 *
 * The refs are re-issued at every snapshot. A ref from an older snapshot may point at a
 * different node after a re-render, and silently clicking the wrong button is worse than
 * asking for a fresh snapshot.
 */

export interface SnapshotElement {
  ref: string;
  role: string;
  name: string;
  tag: string;
  type?: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  href?: string;
  placeholder?: string;
  selector: string;
  visible: boolean;
}

export interface PageSnapshot {
  url: string;
  title: string;
  readyState: string;
  text: string;
  headings: string[];
  links: { text: string; href: string }[];
  elements: SnapshotElement[];
  frames: { url: string; name: string }[];
  scroll: { x: number; y: number; height: number; viewportHeight: number };
  active: { ref?: string; tag: string; name: string } | null;
  alerts: string[];
  counts: { elements: number; links: number; forms: number; images: number };
  /** True when the snapshot list was cut: the page has more controls than the cap. */
  truncated: boolean;
}

export interface SnapshotOptions {
  maxText?: number;
  maxElements?: number;
  maxLinks?: number;
  /** Include elements that are present but not visible (hidden dialogs, collapsed menus). */
  includeHidden?: boolean;
}

function snapshotInPage(options: {
  maxText: number;
  maxElements: number;
  maxLinks: number;
  includeHidden: boolean;
}) {
  const SELECTOR = [
    "a[href]",
    "button",
    "input:not([type=hidden])",
    "textarea",
    "select",
    "summary",
    "[role=button]",
    "[role=link]",
    "[role=checkbox]",
    "[role=radio]",
    "[role=tab]",
    "[role=menuitem]",
    "[role=menuitemcheckbox]",
    "[role=menuitemradio]",
    "[role=combobox]",
    "[role=searchbox]",
    "[role=switch]",
    "[role=option]",
    "[role=slider]",
    "[contenteditable='']",
    "[contenteditable='true']",
    "[onclick]",
  ].join(",");

  const clean = (value: string | null | undefined): string =>
    (value ?? "").replace(/\s+/g, " ").trim();

  const visible = (element: Element): boolean => {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    if (element.closest("[aria-hidden='true']")) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    return true;
  };

  const roleOf = (element: Element): string => {
    const explicit = element.getAttribute("role");
    if (explicit) return explicit;
    const tag = element.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "summary") return "button";
    if (tag === "input") {
      const type = (element as HTMLInputElement).type;
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      if (type === "submit" || type === "button" || type === "reset" || type === "image") {
        return "button";
      }
      return "textbox";
    }
    if (element.getAttribute("contenteditable")) return "textbox";
    return tag;
  };

  const nameOf = (element: Element): string => {
    const aria = element.getAttribute("aria-label");
    if (aria) return clean(aria).slice(0, 100);
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
      if (clean(text)) return clean(text).slice(0, 100);
    }
    const labels = (element as HTMLInputElement).labels;
    if (labels && labels.length > 0) {
      const text = Array.from(labels)
        .map((label) => label.textContent ?? "")
        .join(" ");
      if (clean(text)) return clean(text).slice(0, 100);
    }
    const placeholder = element.getAttribute("placeholder");
    if (placeholder) return clean(placeholder).slice(0, 100);
    const alt = element.getAttribute("alt");
    if (alt) return clean(alt).slice(0, 100);
    const title = element.getAttribute("title");
    if (title) return clean(title).slice(0, 100);
    const tag = element.tagName.toLowerCase();
    if (tag === "input") {
      const input = element as HTMLInputElement;
      if (input.type === "submit" || input.type === "button" || input.type === "reset") {
        return clean(input.value).slice(0, 100);
      }
    }
    const text = clean(element.textContent);
    if (text) return text.slice(0, 100);
    return clean(element.getAttribute("name")).slice(0, 100);
  };

  const selectorFor = (element: Element): string => {
    if (element.id) {
      const byId = `#${CSS.escape(element.id)}`;
      try {
        if (document.querySelectorAll(byId).length === 1) return byId;
      } catch {
        // An id that CSS.escape cannot express falls through to the positional path.
      }
    }
    const parts: string[] = [];
    let node: Element | null = element;
    for (let depth = 0; node && node.nodeType === 1 && depth < 6; depth += 1) {
      const tag = node.tagName.toLowerCase();
      let part = tag;
      const parent: Element | null = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter(
          (child) => child.tagName === node?.tagName
        );
        if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      const candidate = parts.join(" > ");
      try {
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      } catch {
        // Keep walking up.
      }
      node = parent;
    }
    return parts.join(" > ");
  };

  for (const stale of Array.from(document.querySelectorAll("[data-pc-ref]"))) {
    stale.removeAttribute("data-pc-ref");
  }

  const elements: SnapshotElement[] = [];
  let truncated = false;
  const nodes = Array.from(document.querySelectorAll(SELECTOR));
  for (const node of nodes) {
    // A button inside a link is one control, not two: keep the outer one so the ref a model
    // clicks is the one a person would click.
    const ancestorControl = node.parentElement?.closest(SELECTOR);
    if (ancestorControl && !(node instanceof HTMLInputElement)) continue;
    const isVisible = visible(node);
    if (!isVisible && !options.includeHidden) continue;
    if (elements.length >= options.maxElements) {
      truncated = true;
      break;
    }
    const ref = `e${elements.length + 1}`;
    node.setAttribute("data-pc-ref", ref);
    const tag = node.tagName.toLowerCase();
    const role = roleOf(node);
    const entry: SnapshotElement = {
      ref,
      role,
      name: nameOf(node),
      tag,
      selector: selectorFor(node),
      visible: isVisible,
    };
    if (node instanceof HTMLInputElement) {
      entry.type = node.type;
      entry.value = node.type === "password" ? "••••" : node.value.slice(0, 120);
      if (node.type === "checkbox" || node.type === "radio") entry.checked = node.checked;
      if (node.placeholder) entry.placeholder = node.placeholder.slice(0, 80);
    } else if (node instanceof HTMLTextAreaElement) {
      entry.type = "textarea";
      entry.value = node.value.slice(0, 120);
      if (node.placeholder) entry.placeholder = node.placeholder.slice(0, 80);
    } else if (node instanceof HTMLSelectElement) {
      entry.type = "select";
      entry.value = Array.from(node.selectedOptions)
        .map((option) => option.value)
        .join(",")
        .slice(0, 120);
    } else if (node instanceof HTMLAnchorElement) {
      entry.href = node.href;
    }
    if ((node as HTMLButtonElement).disabled) entry.disabled = true;
    if (node.getAttribute("aria-disabled") === "true") entry.disabled = true;
    elements.push(entry);
  }

  const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4"))
    .filter(visible)
    .map((heading) => clean(heading.textContent))
    .filter(Boolean)
    .slice(0, 40);

  const links: { text: string; href: string }[] = [];
  const seenHrefs = new Set<string>();
  for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
    if (links.length >= options.maxLinks) break;
    if (!visible(anchor)) continue;
    const href = (anchor as HTMLAnchorElement).href;
    if (!href || href.startsWith("javascript:") || seenHrefs.has(href)) continue;
    seenHrefs.add(href);
    links.push({ text: clean(anchor.textContent).slice(0, 90) || href, href });
  }

  const frames = Array.from(document.querySelectorAll("iframe")).map((frame) => ({
    url: frame.getAttribute("src") ?? "",
    name: frame.getAttribute("title") ?? frame.getAttribute("name") ?? "",
  }));

  const alerts = Array.from(
    document.querySelectorAll("[role=alert],[role=dialog],[aria-live=assertive]")
  )
    .filter(visible)
    .map((alert) => clean(alert.textContent).slice(0, 200))
    .filter(Boolean)
    .slice(0, 5);

  const activeElement = document.activeElement;
  let active: PageSnapshot["active"] = null;
  if (activeElement && activeElement !== document.body) {
    active = {
      tag: activeElement.tagName.toLowerCase(),
      name: nameOf(activeElement).slice(0, 80),
      ...(activeElement.getAttribute("data-pc-ref")
        ? { ref: activeElement.getAttribute("data-pc-ref") ?? undefined }
        : {}),
    };
  }

  // innerText on purpose: the reading order of a page is part of what it says, and
  // textContent would hand back the CSS-hidden script bodies between the paragraphs.
  // biome-ignore lint/performance/useDomNodeTextContent: rendered text, not node text.
  const bodyText = (document.body?.innerText ?? "")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, options.maxText);

  const snapshot: PageSnapshot = {
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    text: bodyText,
    headings,
    links,
    elements,
    frames,
    scroll: {
      x: window.scrollX,
      y: window.scrollY,
      height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
      viewportHeight: window.innerHeight,
    },
    active,
    alerts,
    counts: {
      elements: elements.length,
      links: document.querySelectorAll("a[href]").length,
      forms: document.forms.length,
      images: document.images.length,
    },
    truncated,
  };
  return snapshot;
}

export function buildSnapshotExpression(options: SnapshotOptions = {}): string {
  const config = {
    maxText: Math.min(options.maxText ?? 14_000, 60_000),
    maxElements: Math.min(options.maxElements ?? 200, 600),
    maxLinks: Math.min(options.maxLinks ?? 80, 300),
    includeHidden: options.includeHidden === true,
  };
  return `(${snapshotInPage.toString()})(${JSON.stringify(config)})`;
}

/** Resolves a ref or selector to what an input event needs: a point and a state. */
export function buildResolveExpression(target: {
  ref?: string;
  selector?: string;
  x?: number;
  y?: number;
}): string {
  const payload = JSON.stringify(target);
  return `(() => {
    const target = ${payload};
    let el = null;
    if (target.ref) el = document.querySelector('[data-pc-ref="' + CSS.escape(String(target.ref)) + '"]');
    else if (target.selector) { try { el = document.querySelector(target.selector); } catch (error) { return { ok: false, reason: "invalid selector: " + error.message }; } }
    if (!el && (typeof target.x === "number" && typeof target.y === "number")) {
      return { ok: true, x: target.x, y: target.y, tag: null, name: null, disabled: false, width: 0, height: 0, point: true };
    }
    if (!el) return { ok: false, reason: target.ref ? "no element has ref " + target.ref + " (take a fresh snapshot)" : "selector matched nothing: " + target.selector };
    try { el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }); } catch (error) {}
    const rect = el.getBoundingClientRect();
    const pointX = Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1);
    const pointY = Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1);
    return {
      ok: true,
      x: pointX,
      y: pointY,
      tag: el.tagName.toLowerCase(),
      name: (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || "").replace(/\\s+/g, " ").trim().slice(0, 80),
      disabled: Boolean(el.disabled) || el.getAttribute("aria-disabled") === "true",
      width: rect.width,
      height: rect.height,
      point: false
    };
  })()`;
}

/** Reads a value, checks a box, or selects options — through real setters and events. */
export function buildSetValueExpression(input: {
  ref?: string;
  selector?: string;
  value?: string;
  values?: string[];
  checked?: boolean;
}): string {
  const payload = JSON.stringify(input);
  return `(() => {
    const input = ${payload};
    let el = null;
    if (input.ref) el = document.querySelector('[data-pc-ref="' + CSS.escape(String(input.ref)) + '"]');
    else if (input.selector) { try { el = document.querySelector(input.selector); } catch (error) { return { ok: false, reason: "invalid selector: " + error.message }; } }
    if (!el) return { ok: false, reason: "target not found (take a fresh snapshot)" };
    if (typeof input.checked === "boolean") {
      if (el.checked !== input.checked) el.click();
      return { ok: true, checked: el.checked };
    }
    if (el instanceof HTMLSelectElement) {
      const wanted = new Set((input.values || [input.value || ""]).map(String));
      for (const option of Array.from(el.options)) option.selected = wanted.has(option.value) || wanted.has(option.text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, value: Array.from(el.selectedOptions).map((o) => o.value).join(",") };
    }
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const proto = el.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, input.value ?? "");
      else el.value = input.value ?? "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, value: el.value };
    }
    if (el.isContentEditable) {
      el.focus();
      document.execCommand("selectAll", false);
      document.execCommand("insertText", false, input.value ?? "");
      return { ok: true, value: el.textContent };
    }
    return { ok: false, reason: "element does not accept a value" };
  })()`;
}

/** A safe, readable keyboard map: CDP needs the key, the code and the virtual key. */
export const KEY_MAP: Record<
  string,
  { key: string; code: string; windowsVirtualKeyCode: number; text?: string }
> = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  Delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
  Home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36 },
  End: { key: "End", code: "End", windowsVirtualKeyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34 },
  Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " },
  " ": { key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " },
};
