import { defineConfig, devices } from '@playwright/test';

// JOT_E2E_PORT lets parallel checkouts on one machine each run their own server.
const PORT = Number(process.env.JOT_E2E_PORT ?? 5174);
// An explicit IPv4 loopback, not localhost: where localhost resolves to both ::1 and
// 127.0.0.1 (the Playwright container in CI), Vite can bind one while Node's WebSocket
// in e2e/raw-client.ts dials the other.
const ORIGIN = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: ORIGIN,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // JOT_E2E_SINGLE_PROCESS (sandboxed shells): see e2e/helpers.ts.
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `pnpm exec vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: ORIGIN,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
