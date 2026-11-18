/**
 * Writes the icons electron-builder needs: build/icon.png (1024), build/icons/<size>.png for
 * the Linux theme, and build/icon.ico for Windows. Same generator as the CLI installers, so
 * the window, the menu entry and the installer all show one mark.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { iconIco, iconPng } from "../../../packaging/assets.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const build = join(here, "..", "build");
mkdirSync(join(build, "icons"), { recursive: true });

writeFileSync(join(build, "icon.png"), iconPng(1024));
for (const size of [16, 32, 48, 64, 128, 256, 512]) {
  writeFileSync(join(build, "icons", `${size}x${size}.png`), iconPng(size));
}
writeFileSync(join(build, "icon.ico"), iconIco());
process.stdout.write(`icons written to ${build}\n`);
