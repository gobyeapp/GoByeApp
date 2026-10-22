import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@gobye/core': r('../../packages/core/src/index.ts'),
      '@': r('./src'),
    },
  },
  server: { port: 5180 },
  // Relative asset paths so the built app can be opened from any folder or static host.
  base: './',
  test: { environment: 'jsdom', globals: false, include: ['src/**/*.test.{ts,tsx}'] },
});
