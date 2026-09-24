// Deterministic generator for the two app icons the web app manifest names
// (M3-P5). Run from the repository root:
//
//   npx tsx scripts/generate-app-icons.ts
//
// It writes public/icons/icon-192.png and public/icons/icon-512.png. The
// fast gate asserts byte-for-byte equality between buildAppIcon() and the
// committed files (test/app/app-icons.test.ts), so the committed bytes are
// reproducible and cannot drift from this source or from the tokens.
//
// THE COLOURS ARE READ FROM styles/tokens.css, never written here (CLAUDE.md
// non-negotiable 4): the background is --pulse-grey-700, the colour behind
// --color-surface-inverse, and the mark is --pulse-paper-300, the colour
// behind --color-ink-inverse, the same pair the dark controls use. Both are
// declared in oklch() and converted to sRGB below, because a PNG carries
// sRGB bytes and nothing else.
//
// THE MARK sits inside the central 60 percent of the square, the safe zone
// a maskable icon keeps when a launcher crops it to a circle, so the one
// file serves as both the "any" and the "maskable" purpose.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

type Rgb = readonly [number, number, number];

const TOKENS = join(__dirname, "..", "styles", "tokens.css");

// The oklch() value of one primitive token, as [lightness 0..1, chroma,
// hue in degrees]. Throws on a token that is missing or not an oklch()
// literal, so a token rename fails the generator loudly.
export const readOklchToken = (css: string, name: string): readonly [number, number, number] => {
  const pattern = new RegExp(
    `${name.replace(/[-]/g, "\\-")}\\s*:\\s*oklch\\(\\s*([0-9.]+)%\\s+([0-9.]+)\\s+([0-9.]+)\\s*\\)`,
  );
  const match = pattern.exec(css);
  if (match === null) {
    throw new Error(`${name} is not declared as an oklch() literal in styles/tokens.css`);
  }
  return [Number(match[1]) / 100, Number(match[2]), Number(match[3])];
};

// OKLCH to 8-bit sRGB (Ottosson's OKLab matrices, then the sRGB transfer
// function), clamped to the gamut.
export const oklchToSrgb = ([lightness, chroma, hue]: readonly [number, number, number]): Rgb => {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const encode = (channel: number): number => {
    const clamped = Math.min(1, Math.max(0, channel));
    const gamma =
      clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(gamma * 255);
  };
  return [encode(linear[0] ?? 0), encode(linear[1] ?? 0), encode(linear[2] ?? 0)];
};

// The pulse line, in unit coordinates of the square: flat, a sharp rise and
// fall, flat again. Every point lies inside [0.2, 0.8] on both axes.
const PULSE: readonly (readonly [number, number])[] = [
  [0.2, 0.55],
  [0.4, 0.55],
  [0.48, 0.3],
  [0.56, 0.72],
  [0.63, 0.55],
  [0.8, 0.55],
];
const STROKE = 0.055;

const distanceToSegment = (
  px: number,
  py: number,
  [ax, ay]: readonly [number, number],
  [bx, by]: readonly [number, number],
): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

// Coverage of one pixel by the stroked line, 0..1, from a 4 by 4 supersample,
// so the edges are smooth and the result is still exactly reproducible.
const coverage = (x: number, y: number, size: number): number => {
  let hits = 0;
  for (let sy = 0; sy < 4; sy += 1) {
    for (let sx = 0; sx < 4; sx += 1) {
      const px = (x + (sx + 0.5) / 4) / size;
      const py = (y + (sy + 0.5) / 4) / size;
      let nearest = Infinity;
      for (let i = 1; i < PULSE.length; i += 1) {
        const from = PULSE[i - 1];
        const to = PULSE[i];
        if (from !== undefined && to !== undefined) {
          nearest = Math.min(nearest, distanceToSegment(px, py, from, to));
        }
      }
      if (nearest <= STROKE / 2) {
        hits += 1;
      }
    }
  }
  return hits / 16;
};

const chunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

// One square RGB PNG of the given edge length.
export const buildAppIcon = (size: number, css: string = readFileSync(TOKENS, "utf8")): Buffer => {
  const background = oklchToSrgb(readOklchToken(css, "--pulse-grey-700"));
  const mark = oklchToSrgb(readOklchToken(css, "--pulse-paper-300"));
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 3);
    row[0] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const cover = coverage(x, y, size);
      for (let channel = 0; channel < 3; channel += 1) {
        const from = background[channel] ?? 0;
        const to = mark[channel] ?? 0;
        row[1 + x * 3 + channel] = Math.round(from + (to - from) * cover);
      }
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  header[10] = 0; // compression
  header[11] = 0; // filter method
  header[12] = 0; // interlace: none
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

export const APP_ICON_SIZES = [192, 512] as const;

export const appIconPath = (size: number): string =>
  join(__dirname, "..", "public", "icons", `icon-${size}.png`);

if (require.main === module) {
  for (const size of APP_ICON_SIZES) {
    const path = appIconPath(size);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, buildAppIcon(size));
    console.log(`wrote ${path}`);
  }
}
