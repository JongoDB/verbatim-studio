import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  // Use relative paths for Electron file:// protocol compatibility
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'pdf-vendor': ['react-pdf'],
          'docx-vendor': ['docx-preview'],
          'audio-vendor': ['wavesurfer.js'],
          'excel-vendor': ['exceljs'],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: true, // Listen on all interfaces
    allowedHosts: true, // Allow any hostname (for tunnels, Electron, etc.)
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        ws: true,
      },
      '/health': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
});
