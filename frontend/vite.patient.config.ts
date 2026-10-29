import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/patient/',
  build: {
    outDir: 'dist/patient',
    emptyOutDir: false,
    rollupOptions: { input: 'patient.html' },
  },
});
