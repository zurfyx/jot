import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// One build for both halves: the client bundle becomes the Worker's static
// assets, and the Worker (with its Durable Object) runs in workerd during
// `pnpm dev`.
export default defineConfig({
  plugins: [react(), cloudflare()],
  server: { port: 5173, strictPort: true },
});
