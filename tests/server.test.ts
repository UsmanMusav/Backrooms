import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index.ts';
import { PROTOCOL } from '../shared/protocol.ts';
import { CELL, FUSE_CELLS, PANEL_CELL, EXIT_CELL } from '../src/level.ts';
import type { ClientMessage, ServerMessage } from '../shared/protocol.ts';

async function connect(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, PROTOCOL);
  const pending: ServerMessage[] = [];
  const listeners = new Set<(message: ServerMessage) => boolean>();
  socket.on('message', data => {
    const message = JSON.parse(data.toString()) as ServerMessage;
    for (const listener of listeners) if (listener(message)) return;
    pending.push(message);
  });
  await once(socket, 'open');
  return {
    socket,
    send: (message: ClientMessage) => socket.send(JSON.stringify(message)),
    wait: <T extends ServerMessage['t']>(type: T, predicate: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true): Promise<Extract<ServerMessage, { t: T }>> => {
      const matches = (m: ServerMessage) => m.t === type && predicate(m as Extract<ServerMessage, { t: T }>);
      const index = pending.findIndex(matches);
      if (index >= 0) return Promise.resolve(pending.splice(index, 1)[0] as Extract<ServerMessage, { t: T }>);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { listeners.delete(listener); reject(new Error(`Timed out waiting for ${type}`)); }, 4000);
        const listener = (m: ServerMessage) => {
          if (!matches(m)) return false;
          clearTimeout(timer); listeners.delete(listener); resolve(m as Extract<ServerMessage, { t: T }>); return true;
        };
        listeners.add(listener);
      });
    },
  };
}

test('real WebSocket clients share a complete round, radio, objectives and host migration', async () => {
  const server = createGameServer();
  const port = await server.listen(0);
  try {
    const health = await fetch(`http://127.0.0.1:${port}/api/health`).then(r => r.json());
    assert.equal(health.protocol, PROTOCOL);
    const a = await connect(port); const b = await connect(port);
    a.send({ t: 'create', name: 'Илья' });
    const welcomeA = await a.wait('welcome');
    b.send({ t: 'join', name: 'Серёга', code: welcomeA.room.code.toLowerCase() });
    const welcomeB = await b.wait('welcome');
    assert.equal(welcomeB.room.players.length, 2);
    a.send({ t: 'start' });
    assert.match((await a.wait('error')).message, /готовности/);
    b.send({ t: 'ready', ready: true });
    await a.wait('state', message => message.room.players.every(p => p.ready));
    a.send({ t: 'start' });
    const started = await a.wait('state', message => message.room.phase === 'playing');
    await b.wait('state', message => message.room.phase === 'playing');
    const actor = started.room.actors.find(p => p.id === welcomeA.id)!;
    a.send({ t: 'pose', seq: 1, pose: { ...actor, x: actor.x + 0.2, moving: true } });
    const moved = await b.wait('state', message => message.room.actors.some(p => p.id === welcomeA.id && p.x > actor.x + 0.1));
    assert.ok(moved.room.elapsed >= 0);
    a.send({ t: 'say', text: 'Я у входа' });
    assert.equal((await b.wait('chat', m => m.line.text === 'Я у входа')).line.name, 'Илья');
    a.socket.send('{');
    assert.equal((await a.wait('error')).message, 'Неверный JSON.');
    const room = server.rooms.get(welcomeA.room.code)!;
    const place = (id: string, cell: { x: number; z: number }, wall = false) => {
      const player = room.members.get(id)!;
      player.x = cell.x * CELL;
      player.z = (wall ? cell.z - 0.5 : cell.z) * CELL + 1.4;
    };
    for (let i = 0; i < 3; i++) {
      place(welcomeA.id, FUSE_CELLS[i]); place(welcomeB.id, FUSE_CELLS[i]);
      a.send({ t: 'interact', interaction: { kind: 'fuse', index: i } });
      b.send({ t: 'interact', interaction: { kind: 'fuse', index: i } });
      await a.wait('state', m => m.room.fuses.filter(Boolean).length === i + 1);
      await b.wait('state', m => m.room.fuses.filter(Boolean).length === i + 1);
    }
    place(welcomeB.id, PANEL_CELL, true);
    b.send({ t: 'interact', interaction: { kind: 'panel' } });
    await a.wait('state', m => m.room.powered);
    place(welcomeA.id, EXIT_CELL, true);
    a.send({ t: 'interact', interaction: { kind: 'exit' } });
    await a.wait('state', m => m.room.phase === 'won');
    await b.wait('state', m => m.room.phase === 'won');
    a.socket.close();
    const migration = await b.wait('state', m => m.room.hostId === welcomeB.id);
    assert.equal(migration.room.players.length, 1);
    b.send({ t: 'lobby' });
    assert.equal((await b.wait('state', m => m.room.phase === 'lobby')).room.players[0].ready, true);
    b.socket.close();
    await once(b.socket, 'close');
  } finally { await server.close(); }
});

test('oversized WebSocket messages are rejected without killing the server', async () => {
  const server = createGameServer(); const port = await server.listen(0);
  try {
    const client = await connect(port);
    const closing = once(client.socket, 'close');
    client.socket.send('x'.repeat(5000));
    const [code] = await closing;
    assert.equal(code, 1009);
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(response.status, 200);
  } finally { await server.close(); }
});

// Raw upgrade requests must neither crash the process nor leave orphan sockets.
test('malformed and unknown upgrade targets close safely', async () => {
  const server = createGameServer(); const port = await server.listen(0);
  try {
    for (const target of ['http://[broken', '/not-a-websocket']) {
      const socket = createConnection({ port, host: '127.0.0.1' });
      socket.on('error', () => {});
      await once(socket, 'connect');
      const closed = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { socket.destroy(); reject(new Error('Upgrade socket was not closed')); }, 2000);
        socket.on('close', () => { clearTimeout(timer); resolve(); });
      });
      socket.write(`GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Protocol: ${PROTOCOL}\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: SGVsbG9Xb3JsZDEyMzQ1Ng==\r\n\r\n`);
      await closed;
    }
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status, 200);
  } finally { await server.close(); }
});


test('embedded server serves real local GLB, suit textures and licenses with nosniff-safe MIME types', async () => {
  const assets = new Map([['index.html', Buffer.from('<title>BACKROOMS</title>')]]);
  for (const file of ['explorer.glb', 'explorer-albedo.jpg', 'CC0-1.0.txt']) assets.set('models/' + file, readFileSync(new URL('../public/models/' + file, import.meta.url)));
  const server = createGameServer({ assets }), port = await server.listen(0, '127.0.0.1');
  try {
    const model = await fetch(`http://127.0.0.1:${port}/models/explorer.glb`);
    assert.equal(model.headers.get('content-type'), 'model/gltf-binary');
    assert.equal(model.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(Buffer.from(await model.arrayBuffer()).toString('ascii', 0, 4), 'glTF');
    const image = await fetch(`http://127.0.0.1:${port}/models/explorer-albedo.jpg`);
    assert.equal(image.headers.get('content-type'), 'image/jpeg'); assert.equal(new Uint8Array(await image.arrayBuffer())[0], 255);
    const license = await fetch(`http://127.0.0.1:${port}/models/CC0-1.0.txt`);
    assert.match(license.headers.get('content-type')!, /^text\/plain/); assert.match(await license.text(), /CC0 1.0/);
    assert.equal((await fetch(`http://127.0.0.1:${port}/models/explorer.glb`, { method: 'HEAD' }).then(r => r.arrayBuffer())).byteLength, 0);
  } finally { await server.close(); }
});
