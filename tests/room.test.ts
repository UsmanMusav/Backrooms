import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom, cleanChat, cleanName, validPose } from '../shared/room.ts';
import { CELL, EXIT_CELL, FUSE_CELLS, PANEL_CELL } from '../src/level.ts';

function fixture() {
  let serial = 0;
  let time = 100_000;
  const events: unknown[] = [];
  const room = new GameRoom('ABC234', event => events.push(event), () => `id-${++serial}`, () => time);
  room.add('a', 'Илья'); room.add('b', 'Серёга');
  const advance = (ms: number) => { time += ms; };
  const start = () => { room.ready('b', true); room.start('a'); };
  const place = (id: string, cell: { x: number; z: number }, wall = false) => {
    const member = room.members.get(id)!;
    member.x = cell.x * CELL;
    member.z = (wall ? cell.z - 0.5 : cell.z) * CELL + (wall ? 1.6 : 1.4);
  };
  return { room, start, advance, place, events };
}

test('names, chat and poses are sanitized and bounded', () => {
  assert.equal(cleanName('<Илья>'), 'Илья');
  assert.equal(cleanName(null), '');
  assert.equal(cleanName('А'.repeat(100)).length, 18);
  assert.equal(cleanChat('  привет\u0000\n  '), 'привет');
  assert.equal(cleanChat('x'.repeat(1000)).length, 160);
  assert.equal(validPose({ x: NaN }), false);
  assert.equal(validPose(null), false);
});

test('only the host can start and everyone must be ready', () => {
  const { room } = fixture();
  assert.throws(() => room.start('b'), /ведущий/);
  assert.throws(() => room.start('a'), /готовности/);
  room.ready('b', true); room.start('a');
  assert.equal(room.phase, 'playing');
  assert.throws(() => room.add('c', 'Поздний'), /уже идёт/);
  assert.throws(() => room.lobby('b'), /ведущий/);
  assert.throws(() => room.lobby('a'), /ещё идёт/);
});

test('rooms have a strict four-human capacity and host migration', () => {
  const { room } = fixture();
  room.add('c', 'Третий'); room.add('d', 'Четвёртый');
  assert.throws(() => room.add('e', 'Пятый'), /четыре/);
  room.remove('a');
  assert.equal(room.hostId, 'b');
  assert.ok(room.members.get('b')!.ready);
  assert.equal(room.members.size, 3);
});

test('movement rejects teleports, stale sequences, non-finite values and walls', () => {
  const { room, start, advance } = fixture(); start();
  const a = room.members.get('a')!;
  const pose = { x: a.x + 0.2, z: a.z, yaw: 1, pitch: 0.1, flashlight: true, moving: true, sprint: false };
  assert.equal(room.move('a', pose, 1), true);
  assert.equal(room.move('a', { ...pose, x: pose.x + 0.1 }, 1), false);
  assert.equal(room.move('a', { ...pose, x: 65 }, 2), false);
  assert.equal(room.move('a', { ...pose, x: Infinity }, 3), false);
  a.x = 5.5 * CELL - 0.3; a.z = 4 * CELL;
  advance(1000);
  assert.equal(room.move('a', { ...pose, x: a.x + 0.5, z: a.z }, 4), false);
});

test('objectives are server-authoritative, shared, idempotent, and range checked', () => {
  const { room, start, place } = fixture(); start();
  assert.throws(() => room.interact('a', { kind: 'fuse', index: 0 }), /ближе/);
  place('a', EXIT_CELL, true);
  assert.throws(() => room.interact('a', { kind: 'exit' }), /заперт/);
  place('a', PANEL_CELL, true);
  assert.throws(() => room.interact('a', { kind: 'panel' }), /три/);
  for (let i = 0; i < 3; i++) {
    place('a', FUSE_CELLS[i]); place('b', FUSE_CELLS[i]);
    room.interact('a', { kind: 'fuse', index: i });
    room.interact('b', { kind: 'fuse', index: i });
  }
  assert.deepEqual(room.view().fuses, [true, true, true]);
  place('b', PANEL_CELL, true); room.interact('b', { kind: 'panel' });
  assert.ok(room.powered);
  place('a', EXIT_CELL, true); room.interact('a', { kind: 'exit' });
  assert.equal(room.phase, 'won');
  room.lobby('a');
  room.ready('b', true); room.start('a');
  assert.deepEqual(room.fuses, [false, false, false]);
  assert.equal(room.powered, false);
  assert.equal(room.round, 2);
});

test('Mimic state stays private and masked actor is indistinguishable in the protocol', () => {
  const { room, start } = fixture(); start();
  for (let i = 0; i < 185; i++) room.tick(0.1);
  const view = room.view();
  assert.equal(view.players.length, 2);
  assert.equal(view.actors.length, 3);
  const bot = view.actors.find(p => !view.players.some(h => h.id === p.id))!;
  assert.equal(bot.name, 'Серёга');
  assert.equal(bot.revealed, undefined);
  const payload = JSON.stringify(view);
  for (const secret of ['trust', 'targetId', 'route', 'learnedSpeed', 'lastPhrase', 'mimic']) assert.ok(!payload.includes(secret));
});

test('server alone applies Mimic damage, dead players cannot interact, all-dead ends round', () => {
  const { room, start } = fixture(); start();
  for (let i = 0; i < 185; i++) room.tick(0.1);
  const brain = room.mimic!;
  brain.phase = 'revealed'; brain.actor.revealed = true;
  for (const id of ['a', 'b']) {
    const victim = room.members.get(id)!;
    brain.actor.x = victim.x + 0.2; brain.actor.z = victim.z;
    room.tick(0.05);
    assert.equal(victim.alive, false);
    assert.throws(() => room.interact(id, { kind: 'panel' }), /нельзя/);
  }
  assert.equal(room.phase, 'lost');
});

test('public radio is rate limited; empty or overlong input is not reflected unsafely', () => {
  const { room, events, advance } = fixture();
  const initial = events.length;
  room.say('a', 'Привет');
  assert.equal(events.length, initial + 1);
  assert.throws(() => room.say('a', 'спам'), /частые/);
  advance(1000); room.say('a', 'x'.repeat(9999));
  assert.equal((events.at(-1) as { text: string }).text.length, 160);
});
