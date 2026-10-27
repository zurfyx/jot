import { defineConfig, devices } from '@playwright/test';

// JOT_E2E_PORT lets parallel checkouts on one machine each run their own server.
const PORT = Number(process.env.JOT_E2E_PORT ?? 5174);
// An explicit IPv4 loopback, not localhost: where localhost resolves to both ::1 and
// 127.0.0.1 (the Playwright container in CI), Vite can bind one while Node's WebSocket
// in e2e/raw-client.ts dials the other.
const ORIGIN = `http://127.0.0.1:${PORT}`;

// The visual suite compares screenshots taken in the Playwright image CI runs in
// (scripts/e2e-docker.sh runs it locally, and sets JOT_E2E_VISUAL); elsewhere
// fonts and antialiasing differ, so a plain `pnpm e2e` on a laptop leaves it out.
const VISUAL = !!process.env.CI || !!process.env.JOT_E2E_VISUAL;
const VISUAL_DIR = /e2e\/visual\//;

const visualProjects = (['light', 'dark'] as const).flatMap((colorScheme) =>
  [
    { size: '1440', viewport: { width: 1440, height: 900 } },
    { size: '390', viewport: { width: 390, height: 844 } },
  ].map(({ size, viewport }) => ({
    name: `visual-${colorScheme}-${size}`,
    testMatch: /e2e\/visual\/.*\.spec\.ts$/,
    use: { ...devices['Desktop Chrome'], viewport, colorScheme, deviceScaleFactor: 1 },
  })),
);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.JOT_E2E_WORKERS ? Number(process.env.JOT_E2E_WORKERS) : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  // One baseline per project, named after the screenshot: no platform suffix,
  // since only the Playwright image takes them.
  snapshotPathTemplate: '{testDir}/visual/baselines/{projectName}/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      // Animations end (finite ones jump to their end, looping ones stop at
      // their start) and the text caret is hidden. A pixel may differ a
      // little in colour (threshold), and a few dozen pixels may differ at
      // all, for antialiasing noise; anything larger fails.
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      threshold: 0.1,
      maxDiffPixels: 40,
    },
  },
  use: {
    baseURL: ORIGIN,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: VISUAL_DIR,
      // JOT_E2E_SINGLE_PROCESS (sandboxed shells): see e2e/helpers.ts.
      use: { ...devices['Desktop Chrome'] },
    },
    ...(VISUAL ? visualProjects : []),
  ],
  webServer: {
    command: `pnpm exec vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: ORIGIN,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
