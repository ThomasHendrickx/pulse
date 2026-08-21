import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // DR-0020: pdfjs-dist runs SERVER SIDE ONLY, and it must run as a real
  // Node package, never through the bundler: bundling its legacy build
  // resolves browser conditions and extraction then throws at runtime,
  // which surfaced as every PDF failing layout-unsupported in the dev
  // server while the same bytes parsed in the fast gate (M3-P2 work
  // notes). Externalizing keeps the dynamic import in
  // adapters/pdf-text-extractor.ts a plain Node module load.
  serverExternalPackages: ["pdfjs-dist"],
  // Deploy-verify defect round (owner-reported production 500): the
  // production symptom's class is the extraction module being
  // unavailable in the DEPLOYED function, and the build's own trace was
  // measured incomplete: the /import page's .nft.json listed
  // legacy/build/pdf.mjs but NOT the package's package.json and NOT
  // legacy/build/pdf.worker.mjs, and the fake-worker setup imports the
  // worker file at first extraction (measured: extraction fails with
  // "Setting up fake worker failed" on a filesystem holding only the
  // traced files). These explicit includes make every function bundle
  // carry the three files the runtime actually loads. The engines field
  // in package.json pins the function runtime to Node 22.x, satisfying
  // pdfjs-dist 6.x's engine floor (>=22.13) instead of inheriting a
  // project-default runtime the dependency does not support.
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/pdfjs-dist/package.json",
      "./node_modules/pdfjs-dist/legacy/build/pdf.mjs",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
  },
  // The production-mode e2e project builds and serves from its own dist
  // directory so it cannot race the dev server's .next in the same
  // worktree; unset, the default ".next" stands.
  ...(process.env.PULSE_DIST_DIR === undefined
    ? {}
    : { distDir: process.env.PULSE_DIST_DIR }),
};

export default withNextIntl(nextConfig);
