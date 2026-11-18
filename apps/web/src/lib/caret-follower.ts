/**
 * The caret follower — the app keeps the point of work in view.
 *
 * Wherever the user is writing (inputs, textareas, contenteditable), every
 * keystroke, click or selection change re-measures the caret's screen position
 * and scrolls every scrollable ancestor — nested panes, the workspace shell,
 * the window — just enough to keep that line on screen. No more hunting for
 * the line you are on.
 *
 * The measurement is honest geometry, not guesswork:
 *  - contenteditable → the selection's client rect;
 *  - textarea → a style-cloned mirror measures the caret line exactly
 *    (wrapping included), because `getBoundingClientRect` cannot see inside;
 *  - single-line input → a width mirror measures the caret's x-offset.
 *
 * One rAF-throttled pass per event burst; the mirror lives for the page's
 * lifetime. Reduced-motion users get the same utility (it is a scroll, not a
 * decoration).
 */

const MARGIN = 88;

let mirror: HTMLDivElement | null = null;
let raf = 0;

function getMirror(): HTMLDivElement {
  if (mirror) return mirror;
  mirror = document.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordBreak = "break-word";
  document.body.appendChild(mirror);
  return mirror;
}

function isEditable(element: Element | null): element is HTMLElement {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return (
      !(element instanceof HTMLInputElement) ||
      ![
        "button",
        "checkbox",
        "radio",
        "range",
        "color",
        "file",
        "submit",
        "reset",
        "image",
      ].includes(element.type)
    );
  }
  // `Element` has no isContentEditable in the DOM typings; HTMLElement does.
  return element instanceof HTMLElement && element.isContentEditable;
}

function cloneTextStyles(target: HTMLElement, into: HTMLElement): void {
  const styles = getComputedStyle(target);
  for (const property of [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "letterSpacing",
    "lineHeight",
    "textTransform",
    "textIndent",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "boxSizing",
    "tabSize",
  ]) {
    into.style.setProperty(property, styles.getPropertyValue(property));
  }
}

interface CaretPoint {
  /** Viewport coordinates of the caret line's top and bottom. */
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function caretInTextarea(element: HTMLTextAreaElement): CaretPoint {
  const box = element.getBoundingClientRect();
  const mirrorEl = getMirror();
  cloneTextStyles(element, mirrorEl);
  mirrorEl.style.width = `${box.width}px`;
  mirrorEl.style.height = "auto";
  const position = element.selectionStart ?? 0;
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  // Text node up to the caret, then the caret marker: its offsetTop/offsetLeft
  // inside the mirror is the caret's position in content coordinates.
  mirrorEl.textContent = element.value.slice(0, position);
  mirrorEl.appendChild(marker);
  const caretTop =
    box.top -
    element.scrollTop +
    (marker.offsetTop as number) +
    parseFloat(getComputedStyle(element).borderTopWidth || "0");
  const lineHeight = parseFloat(getComputedStyle(element).lineHeight || "20") || 20;
  return {
    top: caretTop,
    bottom: caretTop + lineHeight,
    left: box.left + (marker.offsetLeft as number),
    right: box.left + (marker.offsetLeft as number) + 2,
  };
}

function caretInInput(element: HTMLInputElement): CaretPoint {
  const box = element.getBoundingClientRect();
  const position = element.selectionStart ?? 0;
  const mirrorEl = getMirror();
  cloneTextStyles(element, mirrorEl);
  mirrorEl.style.width = "auto";
  mirrorEl.style.whiteSpace = "pre";
  mirrorEl.textContent = element.value.slice(0, position);
  const caretX = (mirrorEl.getBoundingClientRect().width as number) - element.scrollLeft;
  const safeX = Math.max(0, Math.min(caretX, box.width));
  return {
    top: box.top,
    bottom: box.bottom,
    left: box.left + safeX,
    right: box.left + safeX + 2,
  };
}

function caretInSelection(): CaretPoint | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0).cloneRange();
  let rect = range.getBoundingClientRect();
  if (rect.top === 0 && rect.bottom === 0) {
    // Collapsed caret at an empty node: widen by one character.
    const start = range.startContainer;
    if (start.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
      try {
        range.setStart(start, range.startOffset - 1);
        rect = range.getBoundingClientRect();
      } catch {
        /* ignore */
      }
    }
  }
  if (rect.top === 0 && rect.bottom === 0) return null;
  return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
}

function caretRect(): CaretPoint | null {
  const element = document.activeElement;
  if (!isEditable(element)) return null;
  if (element instanceof HTMLTextAreaElement) return caretInTextarea(element);
  if (element instanceof HTMLInputElement) return caretInInput(element);
  return caretInSelection();
}

/** Scrolls `container` (or the window) so the caret band is inside the margins. */
function reveal(container: HTMLElement | null, caret: CaretPoint): void {
  if (container) {
    const box = container.getBoundingClientRect();
    if (
      box.height === 0 ||
      (box.height >= container.scrollHeight && box.width >= container.scrollWidth)
    ) {
      return;
    }
    let deltaY = 0;
    if (caret.bottom > box.bottom - MARGIN) deltaY = caret.bottom - (box.bottom - MARGIN);
    else if (caret.top < box.top + MARGIN) deltaY = caret.top - (box.top + MARGIN);
    if (deltaY !== 0 && container.scrollHeight > container.clientHeight) {
      container.scrollTop = Math.max(
        0,
        Math.min(container.scrollTop + deltaY, container.scrollHeight)
      );
    }
    let deltaX = 0;
    if (caret.right > box.right - MARGIN) deltaX = caret.right - (box.right - MARGIN);
    else if (caret.left < box.left + MARGIN) deltaX = caret.left - (box.left + MARGIN);
    if (deltaX !== 0 && container.scrollWidth > container.clientWidth) {
      container.scrollLeft = Math.max(
        0,
        Math.min(container.scrollLeft + deltaX, container.scrollWidth)
      );
    }
    return;
  }
  // The document itself.
  const winTop = 0;
  const winBottom = window.innerHeight;
  let deltaY = 0;
  if (caret.bottom > winBottom - MARGIN) deltaY = caret.bottom - (winBottom - MARGIN);
  else if (caret.top < winTop + MARGIN) deltaY = caret.top - (winTop + MARGIN);
  if (deltaY !== 0) {
    window.scrollBy({ top: deltaY, behavior: "auto" });
  }
  let deltaX = 0;
  const winRight = window.innerWidth;
  if (caret.right > winRight - MARGIN) deltaX = caret.right - (winRight - MARGIN);
  else if (caret.left < MARGIN) deltaX = caret.left - MARGIN;
  if (deltaX !== 0) {
    window.scrollBy({ left: deltaX, behavior: "auto" });
  }
}

function isScrollable(element: HTMLElement): boolean {
  const styles = getComputedStyle(element);
  const vertical = styles.overflowY === "auto" || styles.overflowY === "scroll";
  const horizontal = styles.overflowX === "auto" || styles.overflowX === "scroll";
  return (
    ((vertical && element.scrollHeight > element.clientHeight) ||
      (horizontal && element.scrollWidth > element.clientWidth)) &&
    element.clientHeight > 0
  );
}

function followCaret(): void {
  raf = 0;
  const caret = caretRect();
  if (!caret) return;
  // Inner scrollables first (nested panes), then the window: each gets only the
  // correction it needs once the inner ones have had their pass.
  let node =
    document.activeElement instanceof HTMLElement ? document.activeElement.parentElement : null;
  const containers: HTMLElement[] = [];
  while (node && node !== document.body) {
    if (isScrollable(node)) containers.push(node);
    node = node.parentElement;
  }
  // One pass per container, innermost last so the window sees the final caret
  // position; order matters little because each reveal() recomputes nothing —
  // but scrolling the small pane first avoids double-correction by the window.
  for (const container of [...containers].reverse()) reveal(container, caret);
  reveal(null, caret);
}

function schedule(): void {
  if (raf) return;
  raf = requestAnimationFrame(followCaret);
}

export function initCaretFollower(): () => void {
  const events = ["input", "keyup", "click", "touchend", "selectionchange", "focusin"] as const;
  const onEvent = () => schedule();
  for (const event of events)
    document.addEventListener(event, onEvent, { capture: true, passive: true });
  return () => {
    for (const event of events) document.removeEventListener(event, onEvent, { capture: true });
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    mirror?.remove();
    mirror = null;
  };
}
