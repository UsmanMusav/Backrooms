import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TensionDirector, FIELD_NOTES } from '../src/tension.ts';
import { createMap, findPath, SPAWN } from '../src/level.ts';

test('room-seeded atmosphere is deterministic and does not replay old sounds on a delayed tab', () => {
  const a = new TensionDirector(441), b = new TensionDirector(441), sounds: string[] = [];
  for (let i = 0; i < 1200; i++) {
    const elapsed = i / 10, f = a.tick(elapsed, 0, false);
    assert.deepEqual(f, b.tick(elapsed, 0, false));
    if (f.event) sounds.push(f.event);
    assert.ok(f.light >= 0 && f.light <= 1.001);
  }
  assert.ok(sounds.length >= 3);
  const late = new TensionDirector(441); assert.equal(late.tick(1000, 0, false).event, undefined);
});
test('second fuse produces a bounded blackout and power restores stable lighting', () => {
  const director = new TensionDirector(); director.tick(1, 0, false); director.tick(2, 1, false);
  assert.equal(director.tick(3, 2, false).event, 'electric');
  assert.ok(director.tick(4, 2, false).light < .1);
  assert.equal(director.tick(7, 2, false).light, 1);
  director.tick(8, 3, true); assert.equal(director.tick(10, 3, true).light, 1);
  for (let t = 10; t < 200; t += .1) assert.equal(director.tick(t, 3, true).light, 1);
  director.reset(); assert.equal(director.tick(0, 0, false).light, 1);
});
test('all optional field notes are in reachable rooms and explain real mechanics', () => {
  const map = createMap();
  assert.equal(FIELD_NOTES.length, 3);
  FIELD_NOTES.forEach(note => assert.ok(findPath(map, SPAWN, note).length > 0));
  assert.match(FIELD_NOTES[1].text, /слышит бег/);
});
