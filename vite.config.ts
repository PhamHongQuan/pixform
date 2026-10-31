import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The WebAssembly encoders load their .wasm via import.meta.url, which pre-bundling would break.
  optimizeDeps: {
    exclude: ['@jsquash/webp', '@jsquash/avif'],
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
});
