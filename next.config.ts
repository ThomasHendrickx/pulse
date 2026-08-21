import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // MICRO ROUND 2 OF THE DEPLOY-VERIFY LOOP, CORRECTED RATHER THAN
  // QUIETLY REWRITTEN (R-087): two earlier rounds tried to keep
  // pdfjs-dist EXTERNAL (serverExternalPackages, then explicit
  // outputFileTracingIncludes for the three runtime-loaded files), and
  // the deployed probe still reported moduleLoad failed while the
  // identical local production build passed: external resolution depends
  // on Vercel's function packaging, which this fleet cannot observe. The
  // dependency is now BUNDLED instead: the adapter imports pdf.mjs and
  // pdf.worker.mjs with literal specifiers and wires the worker through
  // the pdfjsWorker global (see pdf-text-extractor.ts for why the global
  // is what makes the bundle possible), so the server chunks carry the
  // library and no runtime resolution exists to go wrong. Round 1's
  // "bundling breaks extraction" finding was real but had a mechanism:
  // the fake worker's COMPUTED dynamic import, now short-circuited.
  // Size cost, recorded: the package ships 35M (16M legacy builds, the
  // rest modern builds, cmaps, fonts, wasm); the two bundled chunks add
  // about 6M of JS to the server build and nothing else is carried.
  // The production-mode e2e project builds and serves from its own dist
  // directory so it cannot race the dev server's .next in the same
  // worktree; unset, the default ".next" stands.
  ...(process.env.PULSE_DIST_DIR === undefined
    ? {}
    : { distDir: process.env.PULSE_DIST_DIR }),
};

export default withNextIntl(nextConfig);
