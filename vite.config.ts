import { astryxStylex } from '@astryxdesign/build/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// One build for both halves: the client bundle becomes the Worker's static
// assets, and the Worker (with its Durable Object) runs in workerd during
// `pnpm dev`.
export default defineConfig({
  plugins: [
    // StyleX compiles jot's styles and Astryx's component source at build time
    // (D28). It runs before React's plugin, which must see compiled code.
    ...astryxStylex({ rootDir: import.meta.dirname }),
    react(),
    cloudflare(),
  ],
  server: { port: 5173, strictPort: true },
  // The note page chunk carries Lexical and Yjs (about 220 kB gzipped); the
  // landing page loads without it.
  build: { chunkSizeWarningLimit: 800 },
  // The WebLLM worker (editor/ai/webllm/worker.ts) is an ES module worker,
  // and WebLLM, about 6 MB, is in its chunk, loaded only inside it (D26). Its
  // name starts with webllm- so public/_headers can give it its referrer policy.
  worker: {
    format: 'es',
    rolldownOptions: { output: { entryFileNames: 'assets/webllm-[name]-[hash].js' } },
  },
});
