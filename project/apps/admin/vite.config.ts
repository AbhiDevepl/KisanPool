import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@kisanpool/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts') },
  },
  server: {
    port: 5173,
    // the console talks to the same API the apps do; proxying keeps one origin
    // so there is no CORS story and no API URL baked into the bundle
    proxy: { '/admin': 'http://localhost:4000', '/uploads': 'http://localhost:4000' },
  },
});
