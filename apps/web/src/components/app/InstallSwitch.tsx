import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import "./InstallSwitch.css";

/**
 * Install switch — from Uiverse.io by nazar-gavrylyk
 * https://uiverse.io/nazar-gavrylyk/evil-dragon-24
 * MIT License, Copyright (c) nazar-gavrylyk (Nazar)
 *
 * A pill that plays the install as a story: click → the circle pulses, a fill
 * rises inside it for three seconds (the download is real, and so is this
 * animation's length — a shorter lie would read as instant), then the pill
 * narrows, turns green and says "Installée". "Open" is the second label only
 * in the source; here the installed state points at the documentation.
 *
 * Adapted for this codebase: class names are prefixed `insw-` (the original
 * `.label`, `.title`, `.circle` would collide everywhere), the fill animation
 * is disabled under `prefers-reduced-motion`, and the checkmark/success state
 * is announced with `aria-live` rather than left to pixels.
 */

export function InstallSwitch({
  onInstall,
  installedLabel = "Installed",
  installLabel = "Install",
  installedHref,
  errorHint,
  className = "",
}: {
  /** Starts the real download. Return a promise that resolves when it is done. */
  onInstall: () => Promise<void>;
  installedLabel?: string;
  installLabel?: string;
  /** Where the "open" side leads once the story ends. */
  installedHref?: string;
  /** What a failed download should tell the person to do instead. */
  errorHint?: string;
  /** Extra classes on the label, for the host's surface theme. */
  className?: string;
}): ReactElement {
  const [checked, setChecked] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);
  const liveRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!checked) return;
    let alive = true;
    onInstall()
      .then(() => alive && setDone(true))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [checked, onInstall]);

  const labelClass = `insw-label${className ? ` ${className}` : ""}${checked ? " is-checked" : ""}${done ? " is-done" : ""}${error ? " is-error" : ""}`;

  if (done && installedHref) {
    // The story is over; the promise itself is now a link. A button that only
    // replays a three-second animation on every click teaches nothing.
    return (
      <a
        href={installedHref}
        className={`insw-label insw-done-link${className ? ` ${className}` : ""}`}
        data-testid="install-switch-done"
      >
        <svg
          className="insw-icon"
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            d="m5 13 4 4L19 7"
          />
        </svg>
        <span className="insw-title insw-title-static">{installedLabel}</span>
        <span ref={liveRef} className="sr-only" aria-live="polite">
          {installedLabel}
        </span>
      </a>
    );
  }

  return (
    <>
      <label className={labelClass} data-testid="install-switch">
        <input
          type="checkbox"
          className="insw-input"
          checked={checked}
          disabled={checked}
          onChange={(event) => {
            if (event.target.checked) setChecked(true);
          }}
        />
        <span className="insw-circle">
          <svg
            className="insw-icon"
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.5"
              d="M12 19V5m0 14-4-4m4 4 4-4"
            />
          </svg>
          <span className="insw-square" />
        </span>
        <span className="insw-title">{installLabel}</span>
        <span className="insw-title insw-title-installed">{installedLabel}</span>
        <span ref={liveRef} className="sr-only" aria-live="polite">
          {checked && !done ? installLabel : ""}
        </span>
      </label>
      {error ? <p className="insw-error">{errorHint}</p> : null}
    </>
  );
}
