// Deploy-verify wrapper: the repo config plus the container's egress proxy
// for the launched browser (curl honors HTTPS_PROXY, Chromium needs it
// passed explicitly). Used by the fleet's deploy-verify stage:
// PLAYWRIGHT_BASE_URL=<deployed url> npx playwright test --config=playwright.deploy.config.ts
import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

const proxyServer = process.env.HTTPS_PROXY;

export default defineConfig({
  ...baseConfig,
  use: {
    ...baseConfig.use,
    ...(proxyServer ? { proxy: { server: proxyServer } } : {}),
  },
});
