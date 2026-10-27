import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

import { stylex } from './scripts/vite-stylex.ts';

export default defineConfig({
  test: {
    projects: [
      {
        // Modules under test may hold StyleX styles (D28): compile them as the app does.
        plugins: [stylex({ rootDir: import.meta.dirname })],
        test: {
          name: 'unit',
          include: [
            'src/shared/**/*.test.ts',
            'src/client/**/*.test.ts',
            'src/docs/**/*.test.ts',
            'scripts/**/*.test.ts',
          ],
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
