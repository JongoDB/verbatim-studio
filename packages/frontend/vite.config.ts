import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'electron' ? './' : '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: mode === 'electron' ? '../../apps/electron/renderer' : 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
}));
