import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MimicBrain } from '../shared/mimic.ts';
import { CELL, canStand, createMap } from '../src/level.ts';
import type { Actor } from '../shared/protocol.ts';

const map = createMap();
const player = (id = 'human-a', name = 'Илья', skin = 0): Actor => ({ id, name, skin, alive: true, x: 4 * CELL, z: 4 * CELL, yaw: 0, pitch: 0, flashlight: true, moving: false, sprint: false });
const pinNearby = (brain: MimicBrain, human: Actor) => { brain.actor.x = human.x; brain.actor.z = human.z - 2.9; };

test('Mimic borrows a teammate identity and has no enemy flag while masked', () => {
  const brain = new MimicBrain(map, [player(), player('human-b', 'Серёга', 1)], 'opaque-id', 12);
  assert.equal(brain.actor.name, 'Серёга');
  assert.equal(brain.actor.skin, 1);
  assert.equal(brain.actor.id, 'opaque-id');
  assert.equal(brain.actor.revealed, undefined);
  assert.equal(brain.phase, 'masked');
});

test('proximity cannot trigger a reveal before the minimum disguise interval', () => {
  const human = player();
  const brain = new MimicBrain(map, [human]);
  for (let i = 0; i < 590; i++) {
    pinNearby(brain, human);
    const event = brain.tick(0.05, [human], [false, false, false]);
    assert.equal(event.victim, undefined);
    assert.equal(event.revealedNow, undefined);
  }
  assert.ok(brain.trust > 18);
  assert.equal(brain.phase, 'masked');
});

test('sustained approach/attention causes betrayal, not a claim to read human beliefs', () => {
  const human = player();
  const brain = new MimicBrain(map, [human]);
  let reveals = 0;
  for (let i = 0; i < 640; i++) {
    pinNearby(brain, human);
    if (brain.tick(0.05, [human], [false, false, false]).revealedNow) reveals++;
  }
  assert.equal(brain.phase, 'revealed');
  assert.equal(brain.actor.name, 'MIMIC');
  assert.equal(brain.actor.revealed, true);
  assert.equal(reveals, 1);
  brain.actor.x = human.x + 0.2; brain.actor.z = human.z;
  assert.equal(brain.tick(0.05, [human], [false, false, false]).victim, human.id);
});

test('time alone is not enough: a distant player never grants trust', () => {
  const human = player();
  const brain = new MimicBrain(map, [human]);
  for (let i = 0; i < 2200; i++) {
    brain.actor.x = 23 * CELL; brain.actor.z = 20 * CELL;
    brain.tick(0.05, [human], [false, false, false]);
  }
  assert.equal(brain.phase, 'masked');
  assert.equal(brain.trust, 0);
});

test('human-like path following never cuts a wall corner', () => {
  const human = player();
  const brain = new MimicBrain(map, [human], 'opaque', 85);
  let distance = 0;
  for (let i = 0; i < 1800; i++) {
    const x = brain.actor.x; const z = brain.actor.z;
    brain.tick(1 / 60, [human], [false, false, false]);
    distance += Math.hypot(brain.actor.x - x, brain.actor.z - z);
    assert.ok(canStand(map, brain.actor.x, brain.actor.z, 0.18));
  }
  assert.ok(distance > 8);
});

test('Mimic only hears explicitly supplied public game chat and emits ordinary speech', () => {
  const human = player();
  const brain = new MimicBrain(map, [human]);
  brain.hear('проверю щиток');
  const speech: string[] = [];
  for (let i = 0; i < 560; i++) {
    pinNearby(brain, human);
    const event = brain.tick(0.05, [human], [false, false, false]);
    if (event.speech) speech.push(event.speech);
  }
  assert.ok(speech.length >= 1);
  assert.ok(speech.every(line => line.length > 1 && line.length < 90));
});

test('revealed Mimic loses a silent hidden target but hears nearby running through a wall', () => {
  const human = player(), brain = new MimicBrain(map, [human], 'opaque', 165);
  brain.phase = 'revealed'; brain.actor.revealed = true; brain.actor.flashlight = false;
  brain.actor.x = 4 * CELL; brain.actor.z = 4 * CELL;
  human.x = 23 * CELL; human.z = 20 * CELL; human.flashlight = false;
  for (let i = 0; i < 120; i++) brain.tick(.05, [human], [false, false, false]);
  assert.equal(brain.searching, true);
  assert.ok(Math.hypot(brain.actor.x - human.x, brain.actor.z - human.z) > 25);
  // The pillar at x=6 blocks sight between x=4 and x=8.
  brain.actor.x = 4 * CELL; brain.actor.z = 4 * CELL;
  human.x = 8 * CELL; human.z = 4 * CELL; human.moving = true; human.sprint = false;
  brain.tick(.05, [human], [false, false, false]); assert.equal(brain.searching, true);
  human.sprint = true; brain.tick(.05, [human], [false, false, false]); assert.equal(brain.searching, false);
});

test('flashlight in a visible corridor allows revealed Mimic to reacquire a hiding player', () => {
  const human = player(), brain = new MimicBrain(map, [human], 'opaque', 165);
  brain.phase = 'revealed'; brain.actor.revealed = true;
  brain.actor.x = 4 * CELL; brain.actor.z = 4 * CELL;
  human.z = 8 * CELL; human.flashlight = false;
  brain.tick(.05, [human], [false, false, false]); assert.equal(brain.searching, true);
  human.flashlight = true; brain.tick(.05, [human], [false, false, false]); assert.equal(brain.searching, false);
});
