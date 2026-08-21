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
};

export default withNextIntl(nextConfig);
