/**
 * Positional-argument extraction for commands that mix flags with values.
 *
 * The bug this module exists for: flag VALUES are ordinary words to a naive
 * `args.find((arg) => !arg.startsWith("-"))`. `proofcore scan --header "X: y"
 * https://real.site` used to pick `"X: y"` as the scan target, and
 * `proofcore agent --model foo "fix this"` sent `"foo fix this"` to the model as
 * the prompt. Every surface that takes both a positional and valued flags goes
 * through one of these two helpers, so the two can never disagree.
 */

/** Skips the value that follows each of these flags, then any flag word itself. */
export function pickPositional(
  args: readonly string[],
  valueFlags: readonly string[]
): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    // A valued flag consumes the next word even when that word looks like a URL.
    if (valueFlags.includes(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) continue;
    return arg;
  }
  return undefined;
}

/** Same rule, but collects every positional: the agent's prompt is a sentence. */
export function positionalWords(args: readonly string[], valueFlags: readonly string[]): string[] {
  const words: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (valueFlags.includes(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) continue;
    words.push(arg);
  }
  return words;
}
