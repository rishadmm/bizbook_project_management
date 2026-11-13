import { defineConfig } from "@playwright/test";

// Run against a running dev/prod server: E2E_BASE_URL=http://localhost:3101 npm run test:e2e
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3100",
    trace: "off",
    viewport: { width: 1440, height: 900 },
  },
});
