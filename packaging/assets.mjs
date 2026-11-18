/**
 * The files a desktop needs in order to show a clickable application: an icon, and the
 * entry that points at it.
 *
 * Everything here is generated rather than checked in, and generated *identically* for
 * Windows and Linux, so the two installers cannot drift apart on what the app looks like or
 * what it runs. No image library: a PNG is a header, compressed scanlines and four CRCs,
 * which is less code than a dependency and produces the same bytes on every machine.
 */

import { deflateSync } from "node:zlib";

/** Where the mark sits inside the tile, as a fraction of the size. */
const MARK = { left: 0.28, right: 0.72, top: 0.18, bottom: 0.82, bowl: 0.47 };

const BACKGROUND = { r: 11, g: 13, b: 16 };
const FOREGROUND = { r: 245, g: 247, b: 250 };
const ACCENT = { r: 84, g: 214, b: 160 };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * Draws the mark: a dark rounded tile, a light "P", and one accent pixel-row that matches
 * the site's green. Drawn by rectangle tests rather than a font, so it is crisp at every
 * size and identical everywhere.
 */
export function iconPng(size = 256) {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = Math.round(size * 0.22);
  const put = (x, y, colour, alpha = 255) => {
    const offset = (y * size + x) * 4;
    pixels[offset] = colour.r;
    pixels[offset + 1] = colour.g;
    pixels[offset + 2] = colour.b;
    pixels[offset + 3] = alpha;
  };

  const insideTile = (x, y) => {
    const cx = Math.min(x, size - 1 - x);
    const cy = Math.min(y, size - 1 - y);
    if (cx >= radius || cy >= radius) return true;
    const dx = radius - cx;
    const dy = radius - cy;
    return dx * dx + dy * dy <= radius * radius;
  };

  const left = Math.round(size * MARK.left);
  const right = Math.round(size * MARK.right);
  const top = Math.round(size * MARK.top);
  const bottom = Math.round(size * MARK.bottom);
  const bowl = Math.round(top + (bottom - top) * MARK.bowl);
  const stemWidth = Math.max(2, Math.round(size * 0.055));
  const stroke = Math.max(2, Math.round(size * 0.05));

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!insideTile(x, y)) {
        put(x, y, BACKGROUND, 0);
        continue;
      }
      put(x, y, BACKGROUND);

      const inStem = x >= left && x < left + stemWidth && y >= top && y < bottom;
      const inBarTop = y >= top && y < top + stroke && x >= left && x <= right - stroke;
      const inBarBottom = y >= bowl - stroke && y < bowl && x >= left && x <= right - stroke;
      const inBowlRight = x >= right - stroke && x < right && y >= top && y < bowl;
      const isMark = inStem || inBarTop || inBarBottom || inBowlRight;
      if (isMark) put(x, y, FOREGROUND);
    }
  }

  // One accent bar under the mark: the only colour, and the same green as the product.
  const barTop = Math.round(size * 0.86);
  const barHeight = Math.max(1, Math.round(size * 0.03));
  for (let y = barTop; y < Math.min(size, barTop + barHeight); y += 1) {
    for (let x = left; x < right; x += 1) {
      if (insideTile(x, y)) put(x, y, ACCENT);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array()),
  ]);
}

/**
 * Windows wants an .ico. Since Vista an ICO entry may hold a PNG, so this is a small
 * directory in front of images we already generate - no BMP encoding, no bit masks.
 */
export function iconIco(sizes = [16, 24, 32, 48, 64, 128, 256]) {
  const images = sizes.map((size) => ({ size, png: iconPng(size) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + images.length * 16;
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry[0] = image.size >= 256 ? 0 : image.size;
    entry[1] = image.size >= 256 ? 0 : image.size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(image.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

/** Quotes one argument the way a desktop entry's Exec key requires. */
export function desktopQuote(argument) {
  if (!/[\s"'\\$`]/.test(argument)) return argument;
  return `"${argument.replace(/(["\\$`])/g, "\\$1")}"`;
}

export function desktopEntry(entry) {
  const lines = ["[Desktop Entry]", "Type=Application", "Version=1.5", `Name=${entry.name}`];
  if (entry.comment) lines.push(`Comment=${entry.comment}`);
  lines.push(
    `Exec=${entry.exec}`,
    `Icon=${entry.icon}`,
    `Terminal=${entry.terminal ? "true" : "false"}`
  );
  if (entry.categories) lines.push(`Categories=${entry.categories}`);
  lines.push("StartupNotify=true", "StartupWMClass=proofcore");
  for (const [key, value] of Object.entries(entry.extra ?? {})) lines.push(`${key}=${value}`);
  if (entry.desktopActions?.length) {
    // Named actions become right-click items on the icon: one icon, both faces of the app.
    lines.push(`Actions=${entry.desktopActions.map((item) => `${item.id};`).join("")}`);
  }
  for (const action of entry.desktopActions ?? []) {
    lines.push("", `[Desktop Action ${action.id}]`, `Name=${action.name}`, `Exec=${action.exec}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The shell script an icon launches on Windows.
 *
 * A shortcut cannot ask "use Windows Terminal if it exists", so this little wrapper does:
 * a syntax-highlighted, resizable terminal when the machine has one, a plain console when
 * it does not. `%*` passes arguments through, so the shortcut can be used as a launcher for
 * a specific command if someone wants that later.
 */
export function windowsLauncherScript() {
  return [
    "@echo off",
    "setlocal",
    'set "PROOFCORE_BIN=%~dp0proofcore.exe"',
    'if not exist "%PROOFCORE_BIN%" set "PROOFCORE_BIN=proofcore"',
    "where wt.exe >nul 2>nul",
    "if %ERRORLEVEL%==0 (",
    '  start "" wt.exe -w 0 new-tab --title PROOFCORE "%PROOFCORE_BIN%" %*',
    "  exit /b 0",
    ")",
    'start "" cmd.exe /k ""%PROOFCORE_BIN%" %*"',
    "exit /b 0",
    "",
  ].join("\r\n");
}
