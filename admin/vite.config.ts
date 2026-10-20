import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs separately (server/, port 8080); Vite forwards to it.
const api = process.env.TASKLOG_API ?? 'http://localhost:8080';

/** Dev server: /admin and /monitor are served by admin.html, like the Tasklog server does in production. */
const adminPages = (): Plugin => ({
  name: 'tasklog-admin-pages',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && /^\/(admin|monitor)(\/|\?|$)/.test(req.url)) req.url = '/admin.html' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
      next();
    });
  },
});

export default defineConfig({
  plugins: [react(), adminPages()],
  build: {
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
  server: {
    proxy: {
      '/api': api,
      '/auth': api,
    },
  },
});
