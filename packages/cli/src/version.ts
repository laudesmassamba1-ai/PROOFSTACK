/**
 * The one place the CLI version is written.
 *
 * It has to match `var(--cli-version)`... no: it has to match packages/cli/package.json,
 * because `proofcore update` compares this string against the release manifest. A drift
 * between the two makes the CLI either miss updates or offer the same version forever, so a
 * test asserts they are equal.
 */
export const CLI_VERSION = "0.6.3";
