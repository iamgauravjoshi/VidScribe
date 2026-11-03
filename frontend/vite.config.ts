import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';

// https://vite.dev/config/
const frontendDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = resolve(frontendDirectory, '..');

export default defineConfig(({ mode }) => {
  // The app-level .env lives beside backend/ and frontend/, not inside frontend/.
  const env = loadEnv(mode, repositoryDirectory, '');
  const backendPort = Number(process.env.BACKEND_PORT || env.BACKEND_PORT) || 8000;
  const frontendPort = Number(process.env.FRONTEND_PORT || env.FRONTEND_PORT) || 5173;

  return {
    envDir: repositoryDirectory,
    plugins: [react()],
    server: {
      port: frontendPort,
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
