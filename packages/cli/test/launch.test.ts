import { describe, expect, it } from "vitest";
import {
  desktopEntry,
  desktopQuote,
  iconIco,
  iconPng,
  windowsLauncherScript,
} from "../../../packaging/assets.mjs";
import {
  appModeCommand,
  browserPathCandidates,
  defaultBrowserCommand,
  resolveUiUrl,
} from "../src/launch.js";

describe("iconPng", () => {
  it("produces a real PNG with the size in its header", () => {
    const png = iconPng(64);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(64); // width in IHDR
    expect(png.readUInt32BE(20)).toBe(64); // height in IHDR
    expect(png.subarray(-8, -4).toString("latin1")).toBe("IEND");
  });

  it("is deterministic: the same icon on every machine and in every installer", () => {
    expect(iconPng(32).equals(iconPng(32))).toBe(true);
  });
});

describe("iconIco", () => {
  it("wraps every size into one icon file Windows can read", () => {
    const ico = iconIco([16, 32, 256]);
    expect(ico.readUInt16LE(2)).toBe(1); // type: icon
    expect(ico.readUInt16LE(4)).toBe(3); // image count
    // 256 is stored as 0 in a byte-sized dimension field: the ICO convention.
    expect(ico[6 + 0]).toBe(16);
    expect(ico[6 + 32]).toBe(0);
  });

  it("points each entry at its own bytes", () => {
    const ico = iconIco([16, 32]);
    const firstLength = ico.readUInt32LE(6 + 8);
    const secondOffset = ico.readUInt32LE(6 + 16 + 12);
    expect(secondOffset).toBe(6 + 32 + firstLength);
    expect(ico.subarray(secondOffset, secondOffset + 4).toString("hex")).toBe("89504e47");
  });
});

describe("desktopEntry", () => {
  it("writes the keys a menu needs, in the order it needs them", () => {
    const text = desktopEntry({
      name: "PROOFCORE",
      comment: "the hub",
      exec: "/usr/bin/proofcore",
      icon: "proofcore",
      terminal: true,
      categories: "Development;",
    });
    const lines = text.split("\n");
    expect(lines[0]).toBe("[Desktop Entry]");
    expect(text).toContain("Exec=/usr/bin/proofcore");
    expect(text).toContain("Terminal=true");
  });

  it("declares right-click actions and their groups", () => {
    const text = desktopEntry({
      name: "PROOFCORE",
      comment: "",
      exec: "/usr/bin/proofcore",
      icon: "proofcore",
      terminal: true,
      desktopActions: [{ id: "application", name: "Interface", exec: "/usr/bin/proofcore app" }],
    });
    expect(text).toContain("Actions=application;");
    expect(text).toContain("[Desktop Action application]");
    expect(text).toContain("Exec=/usr/bin/proofcore app");
  });

  it("quotes an argument that contains spaces or quotes", () => {
    expect(desktopQuote("/opt/my app/proofcore")).toBe('"/opt/my app/proofcore"');
    expect(desktopQuote("/usr/bin/proofcore")).toBe("/usr/bin/proofcore");
  });
});

describe("windowsLauncherScript", () => {
  it("prefers Windows Terminal and falls back to a console", () => {
    const script = windowsLauncherScript();
    expect(script).toContain("where wt.exe");
    expect(script).toContain("cmd.exe /k");
    // Arguments must reach the binary, or the shortcut cannot be used as a launcher.
    expect(script).toContain("%*");
  });
});

describe("resolveUiUrl", () => {
  it("takes a flag over a configured base, and the base over the public site", () => {
    expect(resolveUiUrl({ flag: "https://a.test", configBase: "https://b.test" })).toBe(
      "https://a.test/app"
    );
    expect(resolveUiUrl({ configBase: "https://b.test" })).toBe("https://b.test/app");
  });

  it("keeps a path that is already there", () => {
    expect(resolveUiUrl({ flag: "https://a.test/app/projects" })).toBe(
      "https://a.test/app/projects"
    );
  });

  it("falls back to the site rather than throwing at the icon", () => {
    expect(resolveUiUrl({ flag: "not a url" })).toMatch(/^https:\/\//);
  });
});

describe("appModeCommand", () => {
  const exists =
    (...paths: string[]) =>
    (candidate: string) =>
      paths.includes(candidate);

  it("uses --app on a Chromium, which is what removes the browser chrome", () => {
    const command = appModeCommand(
      "https://a.test/app",
      "linux",
      exists(...browserPathCandidates("linux"))
    );
    expect(command?.args[0]).toBe("--app=https://a.test/app");
    expect(command?.args).toContain("--class=proofcore");
  });

  it("asks macOS to open the app bundle in a new instance", () => {
    const command = appModeCommand(
      "https://a.test/app",
      "darwin",
      exists(...browserPathCandidates("darwin"))
    );
    expect(command?.file).toBe("open");
    expect(command?.args.slice(0, 2)).toEqual(["-na", "Google Chrome"]);
  });

  it("returns nothing when no Chromium exists, so the caller can be honest", () => {
    expect(appModeCommand("https://a.test/app", "linux", () => false)).toBeNull();
  });

  it("has a default-browser fallback for each platform", () => {
    expect(defaultBrowserCommand("https://a.test", "win32").args.join(" ")).toContain("start");
    expect(defaultBrowserCommand("https://a.test", "darwin").file).toBe("open");
    expect(defaultBrowserCommand("https://a.test", "linux").file).toBe("xdg-open");
  });
});
