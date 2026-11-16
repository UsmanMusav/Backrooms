import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FirstPersonMotion } from '../src/motion.ts';

function simulate(fps: number, moving = true, sprint = false) {
  const motion = new FirstPersonMotion();
  const frames = [];
  for (let i = 0; i < fps * 2; i++) frames.push(motion.update(1 / fps, moving, sprint, .5, true, true));
  return { motion, frames };
}
test('walking and sprinting have smooth visible bob; sprint has greater amplitude', () => {
  const walk = simulate(60), sprint = simulate(60, true, true);
  const range = (frames: typeof walk.frames) => Math.max(...frames.map(f => f.height)) - Math.min(...frames.map(f => f.height));
  assert.ok(range(walk.frames) > .045);
  assert.ok(range(sprint.frames) > range(walk.frames) * 1.3);
  assert.ok(walk.frames.every((f, i, a) => !i || Math.abs(f.height - a[i - 1].height) < .015));
  assert.ok(Math.abs(simulate(30).motion.raised - walk.motion.raised) < .003);
});
test('disabling motion removes camera bob, roll, hand sway and sprint FOV', () => {
  const { motion } = simulate(60, true, true); motion.look(.1, .08);
  const frame = motion.update(1 / 60, true, true, 1, false, true);
  assert.deepEqual([frame.height, frame.roll, frame.pitch, frame.handX, frame.handY, frame.handYaw, frame.handRoll, frame.fov], [0, 0, 0, 0, 0, 0, 0, 72]);
});
test('torch holsters, becomes fully invisible, and raises again without snapping on rapid toggles', () => {
  const motion = new FirstPersonMotion(); motion.reset(true);
  const first = motion.update(1 / 60, false, false, 0, true, false);
  assert.ok(first.visible && first.draw > .8 && first.draw < 1);
  let frame = first;
  for (let i = 0; i < 45; i++) frame = motion.update(1 / 60, false, false, 0, true, false);
  assert.equal(frame.visible, false); assert.equal(motion.raised, 0);
  for (let i = 0; i < 8; i++) frame = motion.update(1 / 60, false, false, 0, true, true);
  const before = frame.draw;
  frame = motion.update(1 / 60, false, false, 0, true, false);
  assert.ok(frame.draw < before && frame.draw > 0);
  for (let i = 0; i < 60; i++) frame = motion.update(1 / 60, false, false, 0, true, true);
  assert.equal(frame.visible, true); assert.equal(motion.raised, 1);
});
test('stopping smoothly settles the camera; look inertia decays without drift', () => {
  const { motion } = simulate(60); motion.look(.1, -.08);
  let frame = motion.update(1 / 60, false, false, 0, true, true);
  assert.ok(Math.abs(frame.handYaw) > .005);
  for (let i = 0; i < 180; i++) frame = motion.update(1 / 60, false, false, 0, true, true);
  assert.ok(Math.abs(frame.roll) < .0001); assert.ok(Math.abs(frame.handYaw) < .0001); assert.ok(Math.abs(frame.height) < .004);
});
