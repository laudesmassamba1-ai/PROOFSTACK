import { Copy, Terminal } from "lucide-react";
import { useState } from "react";

const COMMAND = "proofcore test --module world,flow,exit";

const OUTPUT = `PROOFCORE / EXECUTION

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

Next: proofcore report`;

/**
 * This is intentionally a static example. The browser cannot execute a local
 * command, and the copy never suggests that it did. The label is part of the UI,
 * not a footnote hidden at the bottom.
 *
 * The fiche follows the art direction through the `--fiche-*` variables.
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
        <span className="tp-bar-txt ml-1 flex items-center gap-1.5 font-mono text-[0.66rem]">
          <Terminal size={12} /> exemple enregistré · pas un appel réel
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          className="tp-copy rounded p-1"
          aria-label="Copy example command"
        >
          <Copy size={13} />
        </button>
      </div>
      <div className="terminal-grid px-4 py-5 sm:px-6">
        <p className="tp-cmd">
          <span className="tp-dollar">$ </span>
          {COMMAND}
        </p>
        {copied ? <p className="tp-copied">commande copiée</p> : null}
        <pre className="tp-out">{OUTPUT}</pre>
      </div>
    </div>
  );
}
