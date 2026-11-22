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
    <span aria-label={text}>
      {words.map((word, wordIndex) => {
        const start = charIndex;
        charIndex += word.length + 1;
        return (
          <>
            <span
              key={`${wordIndex}\u0000${word}`}
              aria-hidden="true"
              style={{ display: "inline-block", whiteSpace: "nowrap" }}
            >
              {[...word].map((char, i) => (
                <span
                  key={i}
                  className="m-char"
                  style={
                    {
                      "--ci": String(i),
                      "--c-delay": `${Math.round((start + i) * 26)}ms`,
                    } as React.CSSProperties
                  }
                >
                  <span className="m-char-inner">{char}</span>
                </span>
              ))}
            </span>
            {wordIndex < words.length - 1 ? " " : null}
          </>
        );
      })}
    </span>
  );
}
