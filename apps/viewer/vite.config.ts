import { defineConfig } from 'vite';

// The viewer runs on shop PCs that may be old (Chrome 109 on Windows 7). Keep the output ES2018,
// load nothing from other origins, and never inline assets as data: URLs (the CSP forbids them).
export default defineConfig({
  base: '/v/',
  build: {
    target: 'es2018',
    modulePreload: false,
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    sourcemap: false,
  },
});
