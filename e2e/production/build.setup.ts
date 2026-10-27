import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { test as setup } from '@playwright/test';

/** Builds the app once for the production project (pnpm build). */
setup('build the app', () => {
  setup.setTimeout(180_000);
  execFileSync('pnpm', ['exec', 'vite', 'build', '--logLevel', 'warn'], {
    cwd: join(import.meta.dirname, '../..'),
    stdio: 'inherit',
  });
});
