import { config } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

config({ path: ".env.local", quiet: true });

export default defineConfig({
  testDir: "tests/e2e",
  // A single shared local database: specs must not run concurrently.
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: "http://localhost:3000",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["Desktop Safari"],
        browserName: "webkit",
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "tablet",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1024 },
      },
    },
  ],
  webServer: {
    command: "AI_FAKE=1 npm run dev",
    port: 3000,
    reuseExistingServer: true,
  },
});
