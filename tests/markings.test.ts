import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMap, findPath, SPAWN } from '../src/level.ts';
import { warningCell, wallFaces } from '../src/markings.ts';

const map = createMap();

test('the warning wall sits in a reachable nook well away from the spawn, facing the opening', () => {
  const face = warningCell(map);
  assert.equal(map[face.z][face.x], false);
  assert.ok(wallFaces(map, face).length >= 2, 'a dead end or a corner nook');
  assert.equal(map[face.z + face.dz][face.x + face.dx], true, 'decal is on a wall');
  assert.equal(map[face.z - face.dz][face.x - face.dx], false, 'it faces the only opening');
  assert.ok(findPath(map, SPAWN, face).length >= 10);
  assert.deepEqual(warningCell(map), face, 'deterministic for every co-op client');
});

test('wall faces only point at solid cells', () => {
  for (let z = 1; z < map.length - 1; z++) for (let x = 1; x < map.length - 1; x++) {
    if (map[z][x]) continue;
    for (const f of wallFaces(map, { x, z })) assert.equal(map[z + f.dz][x + f.dx], true);
  }
});
