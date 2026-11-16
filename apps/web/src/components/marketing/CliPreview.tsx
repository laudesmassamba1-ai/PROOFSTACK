import { Copy, Terminal } from "lucide-react";
import { useState } from "react";

const COMMAND = "proofstack test --module world,flow,exit";

const OUTPUT = `PROOFSTACK / EXECUTION

WORLD   ▰▰▰▰▰▰▰▰▱▱  80%
FLOW    ▰▰▰▰▱▱▱▱▱▱  40%
EXIT    Waiting...

[PASS] International form validation
[PASS] Currency precision
[FAIL] Checkout confirmation
[WARN] Missing export metadata

EXECUTION COMPLETE
World      12 passed   1 failed
Flow        8 passed   2 failed
Exit        9 passed   0 failed

Total      29 passed   3 failed
Duration   00:18.42

Next: proofstack report`;

/**
 * This is intentionally a static example. The browser cannot execute a local
 * command, and the copy never suggests that it did. The label is part of the UI,
 * not a footnote hidden at the bottom.
 */
export function CliPreview({ className = "" }: { className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(COMMAND);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={`terminal-preview ${className}`}>
      <div className="terminal-preview-bar flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-[#e967a6]" />
          <span className="size-2 rounded-full bg-[#f28a49]" />
          <span className="size-2 rounded-full bg-[#73d68b]" />
          <span className="ml-2 flex items-center gap-1.5 font-mono text-[0.66rem] text-white/38">
            <Terminal size={12} /> example output · not a live run
          </span>
        </div>
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded p-1 text-white/38 transition-colors hover:text-brand-mint"
          aria-label="Copy example command"
        >
          <Copy size={13} />
        </button>
      </div>
      <div className="terminal-grid px-4 py-5 sm:px-6">
        <p className="font-mono text-[0.79rem] text-brand-mint">
          <span className="text-white/30">$ </span>
          {COMMAND}
        </p>
        {copied ? (
          <p className="mt-2 font-mono text-[0.65rem] text-brand-emerald">command copied</p>
        ) : null}
        <pre className="mt-4 overflow-x-auto font-mono text-[0.69rem] leading-[1.85] text-white/58">
          {OUTPUT}
        </pre>
      </div>
    </div>
  );
}
