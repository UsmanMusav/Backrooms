import { defineConfig } from 'vite';
import type { Server } from 'node:http';
import { createGameServer } from './server/index';

export default defineConfig({
  plugins: [{
    name: 'backrooms-multiplayer',
    configureServer(server) {
      if (!server.httpServer) return;
      const game = createGameServer({ server: server.httpServer as Server });
      server.middlewares.use('/api/health', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, protocol: 'backrooms-v1', rooms: game.rooms.size }));
      });
    },
  }],
  server: { host: '0.0.0.0', allowedHosts: ['.e2b.app'] },
  preview: { host: '0.0.0.0', allowedHosts: ['.e2b.app'] },
  build: { rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
});
