import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { randomInt, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { GameRoom } from '../shared/room.ts';
import { PROTOCOL, PORT } from '../shared/protocol.ts';
import type { ClientMessage, ServerMessage } from '../shared/protocol.ts';

type Socket = WebSocket & { room?: string; playerId: string; alive: boolean; count: number; rateAt: number };
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.json': 'application/json' };
export const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss:; media-src 'self' blob:; object-src 'none'; base-uri 'self'";

export function createGameServer(options: { server?: Server; distDir?: string; assets?: Map<string, Buffer> } = {}) {
  const rooms = new Map<string, GameRoom>();
  const sockets = new Set<Socket>();
  const root = resolve(options.distDir ?? 'dist');
  const httpServer = options.server ?? createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://game.local').pathname); }
    catch { response.writeHead(400).end(); return; }
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (pathname === '/api/health') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ ok: true, protocol: PROTOCOL, rooms: rooms.size }));
      return;
    }
    if (pathname === '/ws') { response.writeHead(426).end('WebSocket required'); return; }
    if (options.assets) {
      if (pathname.startsWith('/api/')) { response.writeHead(404).end(); return; }
      const key = pathname === '/' ? 'index.html' : pathname.slice(1);
      const isAsset = options.assets.has(key);
      const bytes = options.assets.get(key) ?? options.assets.get('index.html');
      response.setHeader('Content-Type', isAsset ? (MIME[extname(key)] ?? 'application/octet-stream') : MIME['.html']);
      response.setHeader('Content-Security-Policy', CSP);
      response.setHeader('Cache-Control', key.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      if (!bytes) { response.writeHead(404).end(); return; }
      response.end(request.method === 'HEAD' ? undefined : bytes);
      return;
    }
    const file = resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    const requested = file !== root && existsSync(file) && statSync(file).isFile() ? file : resolve(root, 'index.html');
    if (!existsSync(requested)) { response.writeHead(503).end('Build the client first: npm run build'); return; }
    if (requested.endsWith('index.html')) response.setHeader('Content-Security-Policy', CSP);
    response.setHeader('Content-Type', MIME[extname(requested)] ?? 'application/octet-stream');
    response.setHeader('Cache-Control', requested.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    if (request.method === 'HEAD') { response.end(); return; }
    createReadStream(requested).on('error', () => response.destroy()).pipe(response);
  });
  const websocket = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false, handleProtocols: protocols => protocols.has(PROTOCOL) ? PROTOCOL : false });
  const send = (socket: Socket, message: ServerMessage) => {
    if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 256_000) socket.send(JSON.stringify(message));
  };
  const broadcast = (code: string, message: ServerMessage) => { for (const socket of sockets) if (socket.room === code) send(socket, message); };
  const publish = (room: GameRoom) => broadcast(room.code, { t: 'state', room: room.view() });
  const makeCode = () => {
    let code: string;
    do { code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''); } while (rooms.has(code));
    return code;
  };
  const upgrade = (request: Parameters<WebSocketServer['handleUpgrade']>[0], socket: Parameters<WebSocketServer['handleUpgrade']>[1], head: Buffer) => {
    let pathname: string;
    try { pathname = new URL(request.url ?? '/', 'http://game.local').pathname; }
    catch { socket.destroy(); return; }
    if (pathname !== '/ws') {
      // A standalone server has no other upgrade handler. Vite does (HMR).
      if (!options.server) socket.destroy();
      return;
    }
    const protocols = String(request.headers['sec-websocket-protocol'] ?? '').split(',').map(v => v.trim());
    if (!protocols.includes(PROTOCOL) || sockets.size >= 256) { socket.destroy(); return; }
    websocket.handleUpgrade(request, socket, head, ws => websocket.emit('connection', ws, request));
  };
  httpServer.on('upgrade', upgrade);
  websocket.on('connection', rawSocket => {
    const socket = rawSocket as Socket;
    Object.assign(socket, { playerId: randomUUID(), alive: true, count: 0, rateAt: Date.now() });
    sockets.add(socket);
    socket.on('pong', () => { socket.alive = true; });
    socket.on('error', () => { /* close handler owns cleanup */ });
    socket.on('message', (data, binary) => {
      try {
        if (binary) throw new Error('Ожидается текстовый протокол.');
        const now = Date.now();
        if (now - socket.rateAt > 1000) { socket.rateAt = now; socket.count = 0; }
        if (++socket.count > 60) { socket.close(1008, 'Rate limit'); return; }
        const message = JSON.parse(data.toString()) as ClientMessage;
        if (!message || typeof message !== 'object' || typeof message.t !== 'string') throw new Error('Неверный формат сообщения.');
        if (message.t === 'ping') {
          if (typeof message.at === 'number' && Number.isFinite(message.at)) send(socket, { t: 'pong', at: message.at });
          return;
        }
        if (message.t === 'create' || message.t === 'join') {
          if (socket.room) throw new Error('Вы уже в комнате.');
          let room: GameRoom | undefined;
          let created = false;
          if (message.t === 'create') {
            if (rooms.size >= 64) throw new Error('Сервер заполнен. Попробуйте позже.');
            const code = makeCode();
            room = new GameRoom(code, line => broadcast(code, { t: 'chat', line }), randomUUID);
            created = true;
          } else {
            if (typeof message.code !== 'string') throw new Error('Введите код комнаты.');
            room = rooms.get(message.code.trim().toUpperCase());
          }
          if (!room) throw new Error('Комната не найдена. Проверьте код и адрес сервера.');
          room.add(socket.playerId, message.name);
          if (created) rooms.set(room.code, room);
          socket.room = room.code;
          send(socket, { t: 'welcome', id: socket.playerId, room: room.view() });
          publish(room);
          return;
        }
        const room = socket.room ? rooms.get(socket.room) : undefined;
        if (!room) throw new Error('Сначала создайте комнату или присоединитесь.');
        switch (message.t) {
          case 'ready': if (typeof message.ready === 'boolean') room.ready(socket.playerId, message.ready); break;
          case 'start': room.start(socket.playerId); break;
          case 'lobby': room.lobby(socket.playerId); break;
          case 'pose': room.move(socket.playerId, message.pose, message.seq); return;
          case 'interact': room.interact(socket.playerId, message.interaction); break;
          case 'say': room.say(socket.playerId, message.text); return;
          default: throw new Error('Неизвестная команда.');
        }
        publish(room);
      } catch (error) {
        send(socket, { t: 'error', message: error instanceof SyntaxError ? 'Неверный JSON.' : error instanceof Error ? error.message : 'Ошибка запроса.' });
      }
    });
    socket.on('close', () => {
      sockets.delete(socket);
      const room = socket.room ? rooms.get(socket.room) : undefined;
      if (!room) return;
      room.remove(socket.playerId);
      if (!room.members.size) rooms.delete(room.code);
      else publish(room);
    });
  });

  let lastTime = performance.now();
  let broadcastTick = 0;
  const interval = setInterval(() => {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    broadcastTick++;
    for (const room of rooms.values()) {
      room.tick(dt);
      if (broadcastTick % 2 === 0) publish(room);
    }
  }, 50);
  interval.unref();
  const heartbeat = setInterval(() => {
    for (const socket of sockets) {
      if (!socket.alive || (!socket.room && Date.now() - socket.rateAt > 30_000)) { socket.terminate(); continue; }
      socket.alive = false;
      socket.ping();
    }
  }, 20_000);
  heartbeat.unref();
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(interval);
    clearInterval(heartbeat);
    httpServer.off('upgrade', upgrade);
    for (const socket of sockets) socket.terminate();
    websocket.close();
    rooms.clear();
  };
  httpServer.once('close', cleanup);
  return {
    httpServer, websocket, rooms,
    listen: (port = PORT, host = '0.0.0.0') => new Promise<number>((resolvePort, reject) => {
      const onError = (error: Error) => reject(error);
      httpServer.once('error', onError);
      httpServer.listen(port, host, () => {
        httpServer.off('error', onError);
        const address = httpServer.address();
        resolvePort(typeof address === 'object' && address ? address.port : port);
      });
    }),
    close: () => new Promise<void>(resolveClose => {
      cleanup();
      if (!httpServer.listening) { resolveClose(); return; }
      httpServer.close(() => resolveClose());
      httpServer.closeAllConnections();
    }),
  };
}
