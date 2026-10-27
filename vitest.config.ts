import { astryxStylex } from '@astryxdesign/build/vite';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        // Modules under test may hold StyleX styles (D28): compile them as the app does.
        plugins: [...astryxStylex({ rootDir: import.meta.dirname })],
        test: {
          name: 'unit',
          include: ['src/shared/**/*.test.ts', 'src/client/**/*.test.ts', 'src/docs/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        // The Durable Object, inside workerd with real SQLite storage.
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
        test: {
          name: 'workers',
          include: ['src/worker/**/*.test.ts'],
        },
      },
    ],
  },
});
