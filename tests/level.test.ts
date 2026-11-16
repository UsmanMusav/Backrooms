import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CELL, MAP_SIZE, SPAWN, FUSE_CELLS, PANEL_CELL, EXIT_CELL, blocked, canStand, cellAt, clearSight, createMap, findPath, seededRandom } from '../src/level.ts';

const map = createMap();

test('the map has solid boundaries and a safe spawn', () => {
  assert.equal(map.length, MAP_SIZE);
  for (const row of map) assert.equal(row.length, MAP_SIZE);
  for (let i = 0; i < MAP_SIZE; i++) {
    assert.ok(map[0][i] && map[MAP_SIZE - 1][i]);
    assert.ok(map[i][0] && map[i][MAP_SIZE - 1]);
  }
  assert.ok(canStand(map, SPAWN.x * CELL, SPAWN.z * CELL));
  assert.ok(blocked(map, -100, -100));
  assert.ok(blocked(map, MAP_SIZE * CELL, MAP_SIZE * CELL));
});

test('every objective is reachable from spawn and every room is connected', () => {
  for (const target of [...FUSE_CELLS, PANEL_CELL, EXIT_CELL]) {
    assert.equal(map[target.z][target.x], false);
    const path = findPath(map, SPAWN, target);
    assert.ok(path.length > 1, `No path to objective ${JSON.stringify(target)}`);
    assert.deepEqual(path[0], SPAWN);
    assert.deepEqual(path.at(-1), target);
  }
  for (let z = 0; z < MAP_SIZE; z++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      if (!map[z][x]) assert.ok(findPath(map, SPAWN, { x, z }).length, `Disconnected cell at ${x}, ${z}`);
    }
  }
});

test('the AI path is cardinal and never crosses a wall', () => {
  for (const start of FUSE_CELLS) {
    for (const end of [...FUSE_CELLS, SPAWN]) {
      const path = findPath(map, start, end);
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        assert.equal(Math.abs(a.x - b.x) + Math.abs(a.z - b.z), 1);
        assert.equal(map[b.z][b.x], false);
        for (let j = 0; j <= 10; j++) {
          assert.ok(canStand(map, (a.x + (b.x - a.x) * j / 10) * CELL, (a.z + (b.z - a.z) * j / 10) * CELL, 0.15));
        }
      }
    }
  }
  assert.deepEqual(findPath(map, { x: 0, z: 0 }, SPAWN), []);
  assert.deepEqual(findPath(map, SPAWN, { x: -1, z: 0 }), []);
});

test('collision respects the player radius at a wall edge', () => {
  // The partition at (6,4) faces the open cell (5,4).
  const edge = (6 - 0.5) * CELL;
  assert.ok(canStand(map, edge - 0.3, 4 * CELL));
  assert.ok(!canStand(map, edge - 0.1, 4 * CELL));
  assert.ok(!canStand(map, 6 * CELL, 4 * CELL));
  assert.deepEqual(cellAt(5 * CELL + 0.2, 4 * CELL - 0.3), { x: 5, z: 4 });
});

test('walls block both sight and interaction', () => {
  assert.ok(clearSight(map, 4 * CELL, 4 * CELL, 5 * CELL, 4 * CELL));
  assert.ok(!clearSight(map, 5 * CELL, 4 * CELL, 7 * CELL, 4 * CELL));
  assert.ok(clearSight(map, 4 * CELL, 4 * CELL, 4 * CELL, 4 * CELL));
});

test('procedural textures are deterministic', () => {
  const a = seededRandom(42);
  const b = seededRandom(42);
  for (let i = 0; i < 100; i++) {
    const value = a();
    assert.equal(value, b());
    assert.ok(value >= 0 && value < 1);
  }
});

test('surface variants are deterministic, weighted and actually vary across the map', async () => {
  const { surfaceVariant } = await import('../src/level.ts');
  const weights = [44, 13, 9, 13, 9, 12];
  assert.deepEqual(surfaceVariant(7, 9, 2, weights, 5), surfaceVariant(7, 9, 2, weights, 5));
  const counts = Array(weights.length).fill(0), turns = new Set<number>();
  let mirrored = 0, total = 0;
  for (let z = 0; z < 27; z++) for (let x = 0; x < 27; x++) for (let face = 0; face < 4; face++) {
    const pick = surfaceVariant(x, z, face, weights, 5); counts[pick.variant]++; turns.add(pick.turn); if (pick.mirror) mirrored++; total++;
  }
  assert.ok(counts.every(count => count > 0), 'every authored variant appears');
  assert.ok(counts[0] / total > .3 && counts[0] / total < .6, 'clean wallpaper stays the most common, damage is occasional');
  assert.equal(turns.size, 4); assert.ok(mirrored / total > .35 && mirrored / total < .65);
  let neighboursDiffer = 0;
  for (let x = 1; x < 26; x++) if (surfaceVariant(x, 4, 0, weights, 5).variant !== surfaceVariant(x + 1, 4, 0, weights, 5).variant) neighboursDiffer++;
  assert.ok(neighboursDiffer > 8, 'adjacent panels do not repeat one texture down a corridor');
});
