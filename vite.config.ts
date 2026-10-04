import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// The saved records live in the browser per origin (http://<host>:<port>), so
// the port must never quietly move to 5174: a busy port fails loudly instead.
export default defineConfig({
  base: './',
  plugins: [preact()],
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  test: { environment: 'node' },
} as any);
