import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so the bundle works from the Electron app:// protocol
  // as well as any static host.
  base: './',
  plugins: [react()],
  worker: {
    format: 'es',
  },
});
