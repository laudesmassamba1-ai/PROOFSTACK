import type { ReactElement } from "react";

/**
 * Per-character masked rise, rendered by React (same contract as SplitWords).
 *
 * The light art direction speaks in letters, not words: a serif headline
 * surfaces character by character as a left-to-right wave — sequential, calm,
 * the opposite of the dark identity's prime-hashed word ripple.
 *
 * Chars live inside word-level inline-block spans: a line may only break
 * BETWEEN words, never inside one ("vos" must not split as "v/os").
 * Screen readers read the inner text in flow: spans are plain inline elements.
 */
export function SplitChars({ text, from = 0 }: { text: string; from?: number }): ReactElement {
  const words = text.split(/\s+/).filter(Boolean);
  let charIndex = from;
  return (
    <>
      {/* Screen readers get the whole string once; the animated letters are visual only. */}
      <span className="sr-only">{text}</span>
      {words.map((word, wordIndex) => {
        const start = charIndex;
        charIndex += word.length + 1;
        return (
          // The key belongs on the outermost returned node: a bare fragment cannot
          // hold one, which made React warn on every render of this component.
          <span key={`${start}\u0000${word}`} aria-hidden="true">
            <span style={{ display: "inline-block", whiteSpace: "nowrap" }}>
              {[...word].map((char, i) => {
                const position = start + i;
                return (
                  <span
                    key={`${char}-${position}`}
                    className="m-char"
                    style={
                      {
                        "--ci": String(i),
                        "--c-delay": `${Math.round(position * 26)}ms`,
                      } as React.CSSProperties
                    }
                  >
                    <span className="m-char-inner">{char}</span>
                  </span>
                );
              })}
            </span>
            {wordIndex < words.length - 1 ? " " : null}
          </span>
        );
      })}
    </>
  );
}
