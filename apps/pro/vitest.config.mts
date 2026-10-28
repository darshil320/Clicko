import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Pure logic only (feature lib/ folders and src/shared). Screens are verified in the running app.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
