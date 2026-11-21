import type { ReactElement } from "react";

/**
 * Splits a plain string into per-word masked spans at render time.
 *
 * React owns the DOM here — that is the whole point. An imperative splitter
 * (replacing textContent with spans after mount) desynchronises the moment a
 * prop changes: a locale switch writes to a detached text node and the heading
 * keeps the old words. Rendering the split keeps every update honest.
 *
 * Each word rises out of its own overflow-clip mask when the parent receives
 * `.is-in` from the motion engine. The stagger is prime-hashed, not uniform, so
 * a line of eight words reveals as a ripple instead of a metronome.
 *
 * Screen readers read the inner text in flow: the spans are plain inline
 * elements without roles or labels, so the sentence is heard as a sentence.
 */
export function SplitWords({ text }: { text: string }): ReactElement {
  const words = text.split(/\s+/).filter(Boolean);
  const nodes: ReactElement[] = [];
  words.forEach((word, index) => {
    // Keys combine the word and its position: repeated words stay distinct and a
    // locale change re-keys every word, which is what we want (the masks re-run).
    const key = `${index}\u0000${word}`;
    if (index > 0) {
      nodes.push(<span key={`sp-${key}`}> </span>);
    }
    nodes.push(
      <span
        key={key}
        className="m-word"
        style={
          {
            "--wi": String(index),
            "--w-delay": `${Math.round((index * 55 + ((index * 2654435761) % 90)) * 10) / 10}ms`,
          } as React.CSSProperties
        }
      >
        <span className="m-word-inner">{word}</span>
      </span>
    );
  });
  return <span>{nodes}</span>;
}
