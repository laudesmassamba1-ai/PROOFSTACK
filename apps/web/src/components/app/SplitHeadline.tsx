import { Fragment, useLayoutEffect, useRef } from "react";
import { riseWords } from "../../lib/choreography.js";

interface SplitHeadlineProps {
  text: string;
  className?: string;
}

/**
 * Giant state-driven headline. Each word sits in a clipping mask so it can rise into place.
 * The h1 carries the full sentence as its accessible name; the word spans are hidden from
 * assistive tech so the sentence is not read word by word.
 */
export function SplitHeadline({ text, className }: SplitHeadlineProps) {
  const ref = useRef<HTMLHeadingElement>(null);
  const words = text.split(/\s+/).filter(Boolean);

  useLayoutEffect(() => {
    const node = ref.current;
    // `text` gates the first real headline; riseWords itself plays only once per page session.
    if (!node || !text) return;
    return riseWords(node);
  }, [text]);

  return (
    <h1 ref={ref} className={className} aria-label={text}>
      {/* Index keys are safe: the word list is rebuilt whole when `text` changes. */}
      {words.map((word, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static list rebuilt with text
        <Fragment key={`${index}-${word}`}>
          <span className="split-mask" aria-hidden="true">
            <span className="split-word">{word}</span>
          </span>
          {index < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </h1>
  );
}
