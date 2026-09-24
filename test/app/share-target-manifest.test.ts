import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import manifest from "../../src/app/manifest";
import {
  APP_ICON_SIZES,
  appIconPath,
  buildAppIcon,
  oklchToSrgb,
  readOklchToken,
} from "../../scripts/generate-app-icons";

// M3-P5. The manifest's share target and the two icons it names, checked
// without a server. The deployed shape (the manifest served at
// /manifest.webmanifest without a session, the icons resolving) is the
// slow gate's, in test/e2e/share-target.spec.ts.

describe("the web app manifest", () => {
  const m = manifest();

  test("declares a POST multipart share target taking a PDF in the upload's file field", () => {
    expect(m.share_target).toEqual({
      action: "/import/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        files: [{ name: "file", accept: ["application/pdf", ".pdf"] }],
      },
    });
  });

  test("carries what Chromium needs to install: a name, a start URL, a standalone display and 192 and 512 pixel icons", () => {
    expect(m.name).toBe("Pulse");
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
    const sizes = (m.icons ?? []).map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  test("carries no literal colour (CLAUDE.md non-negotiable 4)", () => {
    expect(m.theme_color).toBeUndefined();
    expect(m.background_color).toBeUndefined();
  });
});

describe("the app icons", () => {
  test.each(APP_ICON_SIZES)(
    "icon-%i.png is byte for byte what the generator builds from the tokens",
    (size) => {
      expect(readFileSync(appIconPath(size)).equals(buildAppIcon(size))).toBe(true);
    },
  );

  test("the generator reads its colours from the tokens and fails loudly on a missing token", () => {
    const css = "--pulse-grey-700: oklch(23% 0.008 265);";
    expect(readOklchToken(css, "--pulse-grey-700")).toEqual([0.23, 0.008, 265]);
    expect(() => readOklchToken(css, "--pulse-paper-300")).toThrow(/--pulse-paper-300/);
  });

  test("oklch white and black convert to sRGB white and black", () => {
    expect(oklchToSrgb([1, 0, 0])).toEqual([255, 255, 255]);
    expect(oklchToSrgb([0, 0, 0])).toEqual([0, 0, 0]);
  });
});
