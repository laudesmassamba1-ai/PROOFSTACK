import { describe, expect, it } from "vitest";
import { evaluate, type MachineFacts, summarize } from "../src/doctor-env.js";
import { analyzeStack, type StackFacts, satisfiesNodeRange } from "../src/stack-check.js";
import {
  compareVersions,
  installKind,
  parseManifest,
  planFor,
  updateAvailable,
} from "../src/update.js";

describe("compareVersions", () => {
  it("orders releases by number, not by string", () => {
    // The bug this prevents: "0.9.0" > "0.10.0" as strings, so an update is never offered.
    expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
    expect(compareVersions("0.9.0", "0.10.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  it("treats a release as newer than its own pre-release", () => {
    expect(compareVersions("1.0.0", "1.0.0-rc1")).toBe(1);
    expect(compareVersions("1.0.0-rc1", "1.0.0")).toBe(-1);
  });

  it("accepts a leading v and missing components", () => {
    expect(compareVersions("v1.2", "1.2.0")).toBe(0);
    expect(compareVersions("v2", "1.9.9")).toBe(1);
  });
});

describe("updateAvailable", () => {
  it("is null when the state has no answer, so a failed check is not an update", () => {
    expect(
      updateAvailable({
        checkedAt: "",
        currentVersion: "0.2.0",
        latestVersion: null,
        channel: "stable",
      })
    ).toBeNull();
  });

  it("names the newer release", () => {
    expect(
      updateAvailable({
        checkedAt: "",
        currentVersion: "0.2.0",
        latestVersion: "0.3.0",
        channel: "stable",
      })
    ).toBe("0.3.0");
  });

  it("offers nothing when the local build is ahead", () => {
    expect(
      updateAvailable({
        checkedAt: "",
        currentVersion: "0.4.0",
        latestVersion: "0.3.0",
        channel: "stable",
      })
    ).toBeNull();
  });
});

describe("installKind", () => {
  it("recognises a standalone binary, with and without the extension", () => {
    expect(installKind("/usr/local/bin/proofcore", "/usr/local/bin/proofcore")).toBe("binary");
    expect(installKind("C:\\Users\\x\\AppData\\Local\\PROOFCORE\\bin\\proofcore.exe", "")).toBe(
      "binary"
    );
  });

  it("recognises an npm installation and refuses to touch it", () => {
    expect(installKind("/usr/bin/node", "/usr/lib/node_modules/proofcore/dist/index.js")).toBe(
      "npm"
    );
  });

  it("recognises a checkout", () => {
    expect(installKind("/usr/bin/node", "/home/me/PROOFSTACK/packages/cli/src/index.ts")).toBe(
      "source"
    );
  });
});

describe("parseManifest", () => {
  const good = {
    version: "0.3.0",
    channel: "stable",
    files: { "linux-x64": { binary: "proofcore-linux-x64", sha256: "a".repeat(64), size: 10 } },
  };

  it("keeps a well-formed manifest", () => {
    const manifest = parseManifest(good);
    expect(manifest?.version).toBe("0.3.0");
    expect(manifest?.files["linux-x64"]?.binary).toBe("proofcore-linux-x64");
  });

  it("rejects a version that is not a version", () => {
    expect(parseManifest({ ...good, version: "latest" })).toBeNull();
  });

  it("rejects a manifest with no usable file", () => {
    expect(parseManifest({ version: "0.3.0", files: { "linux-x64": { binary: 42 } } })).toBeNull();
  });

  it("rejects anything that is not an object", () => {
    expect(parseManifest("<html>404</html>")).toBeNull();
  });
});

describe("planFor", () => {
  const manifest = {
    version: "0.3.0",
    files: {
      "linux-x64": { binary: "proofcore-linux-x64", sha256: "b".repeat(64), size: 5 },
      "win-x64": { binary: "proofcore-win-x64.exe", sha256: "short", size: 5 },
    },
  };

  it("resolves the asset against the manifest, so mirrors work without config", () => {
    const plan = planFor(manifest, "linux-x64", "binary");
    expect(plan.ok).toBe(true);
    // The default manifest is now our API's mirror, not the release host: the binary sits
    // beside the manifest, so the resolution rule is the same and the origin changed.
    if (plan.ok)
      expect(plan.url.endsWith("/api/v1/releases/assets/proofcore-linux-x64")).toBe(true);
  });

  it("refuses a target the release does not build", () => {
    const plan = planFor(manifest, "linux-arm64", "binary");
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toContain("no build for linux-arm64");
  });

  it("refuses a file whose checksum is not a checksum", () => {
    // An update without a verifiable digest is a way to run someone else's code.
    const plan = planFor(manifest, "win-x64", "binary");
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toContain("checksum");
  });

  it("sends an npm installation back to npm", () => {
    const plan = planFor(manifest, "linux-x64", "npm");
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toContain("npm install -g proofcore@latest");
  });
});

const facts = (overrides: Partial<MachineFacts> = {}): MachineFacts => ({
  platform: "linux",
  arch: "x64",
  nodeVersion: "22.11.0",
  isGitRepo: true,
  gitVersion: "git version 2.43.0",
  dockerVersion: "Docker version 27.0.0",
  browserPath: "/usr/bin/google-chrome",
  browserSource: "PATH",
  configDir: "/home/me/.config/proofcore",
  configWritable: true,
  sessionMode: 0o600,
  freeDiskBytes: 20 * 1024 ** 3,
  executableDir: "/home/me/.local/share/proofcore/bin",
  executableDirWritable: true,
  columns: 120,
  colorEnabled: true,
  installs: [
    {
      path: "/home/me/.local/bin/proofcore",
      realPath: "/home/me/.local/share/proofcore/bin/proofcore",
      kind: "standalone",
    },
  ],
  ...overrides,
});

describe("evaluate", () => {
  it("reports a healthy machine without warnings", () => {
    const summary = summarize(evaluate(facts()));
    expect(summary.fail).toBe(0);
    expect(summary.warn).toBe(0);
  });

  it("warns when two installs compete for the same command", () => {
    const checks = evaluate(
      facts({
        installs: [
          { path: "/a/proofcore", realPath: "/a/node_modules/proofcore/proofcore.js", kind: "npm" },
          { path: "/b/proofcore", realPath: "/b/proofcore", kind: "standalone" },
        ],
      })
    );
    const install = checks.find((check) => check.name === "install");
    expect(install?.status).toBe("warn");
    expect(install?.fix).toContain("/b/proofcore");
  });

  it("warns when the desktop app comes first, because it opens a window instead", () => {
    const checks = evaluate(
      facts({
        installs: [
          { path: "/usr/bin/proofcore", realPath: "/opt/App/proofcore", kind: "desktop" },
          {
            path: "/home/me/.local/bin/proofcore",
            realPath: "/home/me/.local/bin/proofcore",
            kind: "standalone",
          },
        ],
      })
    );
    const install = checks.find((check) => check.name === "install");
    expect(install?.status).toBe("warn");
    expect(install?.fix).toContain("opens a window");
  });

  it("accepts the desktop app next to the CLI, as long as the CLI answers first", () => {
    const checks = evaluate(
      facts({
        installs: [
          {
            path: "/home/me/.local/bin/proofcore",
            realPath: "/home/me/.local/bin/proofcore",
            kind: "standalone",
          },
          { path: "/usr/bin/proofcore", realPath: "/opt/App/proofcore", kind: "desktop" },
        ],
      })
    );
    expect(checks.find((check) => check.name === "install")?.status).toBe("ok");
  });

  it("flags a session file other users could read", () => {
    const checks = evaluate(facts({ sessionMode: 0o644 }));
    const session = checks.find((check) => check.name === "session permissions");
    expect(session?.status).toBe("warn");
    expect(session?.fix).toContain("chmod 600");
  });

  it("fails when the config directory is not writable, and says how to fix it", () => {
    const checks = evaluate(facts({ configWritable: false }));
    const config = checks.find((check) => check.name === "config");
    expect(config?.status).toBe("fail");
    expect(config?.fix).toContain("chown");
  });

  it("warns when a read-only install makes self-update impossible", () => {
    const checks = evaluate(facts({ executableDirWritable: false }));
    expect(checks.find((check) => check.name === "executable")?.status).toBe("warn");
  });

  it("fails an unsupported runtime instead of pretending it will work", () => {
    const checks = evaluate(facts({ nodeVersion: "16.20.0" }));
    expect(checks.find((check) => check.name === "node")?.status).toBe("fail");
  });

  it("skips Docker rather than failing, since it is optional", () => {
    const checks = evaluate(facts({ dockerVersion: null }));
    expect(checks.find((check) => check.name === "docker")?.status).toBe("skip");
  });

  it("warns below one gigabyte of disk", () => {
    const checks = evaluate(facts({ freeDiskBytes: 200 * 1024 ** 2 }));
    expect(checks.find((check) => check.name === "disk")?.status).toBe("warn");
  });
});

describe("satisfiesNodeRange", () => {
  it("understands the ranges that appear in real engines fields", () => {
    expect(satisfiesNodeRange(">=20", "22.1.0")).toBe(true);
    expect(satisfiesNodeRange(">=20", "18.19.0")).toBe(false);
    expect(satisfiesNodeRange("^18.0.0", "18.19.1")).toBe(true);
    expect(satisfiesNodeRange("^18.0.0", "20.0.0")).toBe(false);
    expect(satisfiesNodeRange(">=18 <21 || >=22", "22.3.0")).toBe(true);
    expect(satisfiesNodeRange("20.x", "20.11.0")).toBe(true);
    expect(satisfiesNodeRange("20.x", "22.0.0")).toBe(false);
  });

  it("does not crash on a range it cannot read", () => {
    expect(satisfiesNodeRange("*", "22.0.0")).toBe(false);
    expect(satisfiesNodeRange("latest", "22.0.0")).toBe(false);
  });
});

const stackFacts = (overrides: Partial<StackFacts> = {}): StackFacts => ({
  packageJson: {
    name: "shop",
    engines: { node: ">=20" },
    dependencies: { next: "14.2.0", react: "18.3.0" },
    devDependencies: { typescript: "5.5.0" },
  },
  lockfiles: ["pnpm-lock.yaml"],
  installed: { next: "14.2.0", react: "18.3.0", typescript: "5.5.0" },
  nodeVersion: "22.11.0",
  ...overrides,
});

describe("analyzeStack", () => {
  it("reads the stack it will be auditing", () => {
    const checks = analyzeStack(stackFacts());
    expect(checks.find((check) => check.name === "project")?.detail).toBe("shop");
    expect(checks.find((check) => check.name === "framework")?.detail).toContain("next@14.2.0");
  });

  it("reports a project it cannot see instead of inventing one", () => {
    const checks = analyzeStack(stackFacts({ packageJson: null }));
    expect(checks).toHaveLength(1);
    expect(checks[0]?.status).toBe("skip");
  });

  it("warns about several lockfiles, naming them", () => {
    const checks = analyzeStack(stackFacts({ lockfiles: ["pnpm-lock.yaml", "package-lock.json"] }));
    const lockfile = checks.find((check) => check.name === "lockfile");
    expect(lockfile?.status).toBe("warn");
    expect(lockfile?.detail).toContain("package-lock.json");
  });

  it("warns when the runtime does not satisfy engines.node", () => {
    const checks = analyzeStack(stackFacts({ nodeVersion: "18.20.0" }));
    expect(checks.find((check) => check.name === "engines.node")?.status).toBe("warn");
  });

  it("catches a Playwright split between runner and driver", () => {
    const checks = analyzeStack(
      stackFacts({ installed: { playwright: "1.45.0", "@playwright/test": "1.47.0" } })
    );
    expect(checks.find((check) => check.name === "playwright")?.status).toBe("warn");
  });

  it("catches two React copies, which is the invalid-hook-call bug", () => {
    const checks = analyzeStack(stackFacts({ reactDuplicates: ["18.2.0", "18.3.0"] }));
    expect(checks.find((check) => check.name === "react copies")?.status).toBe("warn");
  });
});
