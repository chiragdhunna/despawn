import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The server hosts the owner app under /app/. No data: URLs (the CSP forbids them).
export default defineConfig({
  base: '/app/',
  plugins: [react()],
  build: { target: 'es2022', assetsInlineLimit: 0, sourcemap: false },
  worker: { format: 'es' },
});
