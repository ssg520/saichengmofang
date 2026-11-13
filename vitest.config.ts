import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// Engine tests run in plain Node (no DOM). Keep this separate from vite.config.ts
// so the React plugin and local proxy are not pulled into the test runtime.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)), 'edmonds-blossom': fileURLToPath(new URL('./engine/vendor/edmonds-blossom.js', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['engine/**/*.test.ts'],
  },
});