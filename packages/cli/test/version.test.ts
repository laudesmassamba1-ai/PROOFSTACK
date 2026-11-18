import { expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { CLI_VERSION } from "../src/version.js";

it("the version the CLI reports is the version it is published as", () => {
  // `proofcore update` compares this string to the release manifest. If it drifts from the
  // package that was built, the binary either never sees an update or offers one forever.
  expect(CLI_VERSION).toBe(pkg.version);
});
