import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

async function asset() {
  const bytes = readFileSync(new URL('../public/models/explorer.glb', import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}
test('bundled explorer is a continuous weighted GLB with a real skeleton and eight embedded clips', async () => {
  const model = await asset(); const body = model.scene.getObjectByName('Explorer_Suit') as THREE.SkinnedMesh;
  assert.ok(body.isSkinnedMesh); assert.equal(body.skeleton.bones.length, 65);
  assert.ok(body.geometry.attributes.position.count > 7000);
  assert.ok(body.geometry.index!.count > 30000);
  const weights = body.geometry.attributes.skinWeight;
  for (let i = 0; i < weights.count; i++) assert.ok(Math.abs(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i) - 1) < .015);
  assert.deepEqual(model.animations.map(c => c.name).sort(), ['attack', 'death', 'idle', 'interact', 'reveal', 'run', 'torch', 'walk']);
  for (const clip of model.animations) {
    assert.ok(clip.tracks.length > 40 && clip.duration > .3);
    assert.ok(clip.tracks.some(t => t.name.includes('hand_')));
    assert.ok(clip.tracks.every(t => [...t.values].every(Number.isFinite)));
  }
  const jsonLength = readFileSync(new URL('../public/models/explorer.glb', import.meta.url)).readUInt32LE(12);
  assert.ok(jsonLength > 0);
});
test('retargeted locomotion visibly deforms limbs without exploding the skin or moving the root', async () => {
  const model = await asset(), mixer = new THREE.AnimationMixer(model.scene);
  const hand = model.scene.getObjectByName('hand_l')!, positions: THREE.Vector3[] = [];
  const body = model.scene.getObjectByName('Explorer_Suit') as THREE.SkinnedMesh;
  for (const name of ['idle', 'torch', 'walk', 'run', 'death']) {
    const clip = model.animations.find(c => c.name === name)!; mixer.clipAction(clip).play(); mixer.update(clip.duration * .42); model.scene.updateMatrixWorld(true);
    positions.push(hand.getWorldPosition(new THREE.Vector3()));
    body.computeBoundingBox(); const box = body.boundingBox!;
    assert.ok(box.min.y > -.35 && box.max.y < 2.2 && box.max.x - box.min.x < 3.5, `${name} has valid skin bounds`);
    assert.ok(model.scene.position.length() < .001); mixer.stopAllAction();
  }
  assert.ok(positions[0].distanceTo(positions[1]) > .3); assert.ok(positions[2].distanceTo(positions[3]) > .1);
});
test('all model dependencies and CC0 notices are bundled locally', () => {
  const directory = new URL('../public/models/', import.meta.url);
  for (const path of ['explorer-albedo.jpg', 'explorer-normal.jpg', 'explorer-roughness.png', 'explorer-eyes.jpg']) assert.ok(readFileSync(new URL(path, directory)).length > 1000);
  assert.match(readFileSync(new URL('Quaternius-Standard-License.txt', directory), 'utf8'), /CC0/);
  assert.match(readFileSync(new URL('CC0-1.0.txt', directory), 'utf8'), /CC0 1.0/);
  assert.match(readFileSync(new URL('CREDITS.md', directory), 'utf8'), /Quaternius/);
  const bytes = readFileSync(new URL('explorer.glb', directory));
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.ok(json.buffers.every((buffer: { uri?: string }) => !buffer.uri)); assert.equal(json.images, undefined);
});
