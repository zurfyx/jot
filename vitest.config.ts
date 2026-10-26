import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
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
