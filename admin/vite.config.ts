import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs separately (server/, port 8080); Vite forwards to it.
const api = process.env.TASKLOG_API ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': api,
      '/auth': api,
    },
  },
});
