import type { ReactElement } from "react";

/**
 * Per-character masked rise, rendered by React (same contract as SplitWords).
 *
 * The light art direction speaks in letters, not words: a serif headline
 * surfaces character by character as a left-to-right wave — sequential, calm,
 * the opposite of the dark identity's prime-hashed word ripple.
 *
 * Screen readers read the inner text in flow: spans are plain inline elements.
 */
export function SplitChars({ text, from = 0 }: { text: string; from?: number }): ReactElement {
  const chars = [...text];
  return (
    <span aria-label={text}>
      {chars.map((char, index) => {
        const delay = Math.round((from + index) * 26);
        return (
          <span
            key={`${index}\u0000${char}`}
            aria-hidden="true"
            className="m-char"
            style={{ "--ci": String(index), "--c-delay": `${delay}ms` } as React.CSSProperties}
          >
            <span className="m-char-inner">{char === " " ? "\u00A0" : char}</span>
          </span>
        );
      })}
    </span>
  );
}
