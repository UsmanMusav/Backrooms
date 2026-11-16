/* Optional art-source tool. The finished GLB/textures are checked in under public/models.
 * Inputs: Quaternius UBC Standard + UAL Standard glTF files in .cache/character-source.
 * See public/models/CREDITS.md for the CC0 sources. No Blender/native executable is needed.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { retargetClip } from 'three/addons/utils/SkeletonUtils.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

globalThis.ProgressEvent ??= class ProgressEvent { constructor(type, data) { this.type = type; Object.assign(this, data); } };
globalThis.FileReader ??= class FileReader {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(data => { this.result = data; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then(data => { this.result = `data:${blob.type};base64,${Buffer.from(data).toString('base64')}`; this.onloadend?.(); }); }
};
const root = '.cache/character-source/';
async function load(file) {
  const json = JSON.parse(readFileSync(root + file, 'utf8'));
  for (const buffer of json.buffers) buffer.uri = 'data:application/octet-stream;base64,' + readFileSync(root + buffer.uri).toString('base64');
  delete json.images; delete json.textures; delete json.samplers;
  for (const material of json.materials ?? []) {
    delete material.normalTexture;
    material.pbrMetallicRoughness = { baseColorFactor: [1, 1, 1, 1], roughnessFactor: 0.9, metallicFactor: 0 };
  }
  return new GLTFLoader().parseAsync(JSON.stringify(json), '');
}
const body = await load('Superhero_Male_FullBody.gltf');
const library = await load('AnimationLibrary_Godot_Standard.gltf');
let target, source;
body.scene.traverse(o => { if (o.isSkinnedMesh && /SuperHero/i.test(o.name)) target = o; });
library.scene.traverse(o => { if (o.isSkinnedMesh) source ??= o; });
if (!target || !source) throw new Error('Expected skinned characters in the source files');
const names = { root: 'root', pelvis: 'DEF-hips', spine_01: 'DEF-spine.001', spine_02: 'DEF-spine.002', spine_03: 'DEF-spine.003', neck_01: 'DEF-neck', Head: 'DEF-head' };
for (const [ue, universal] of [['clavicle', 'shoulder'], ['upperarm', 'upper_arm'], ['lowerarm', 'forearm'], ['hand', 'hand'], ['thigh', 'thigh'], ['calf', 'shin'], ['foot', 'foot'], ['ball', 'toe']]) {
  for (const side of ['l', 'r']) names[`${ue}_${side}`] = `DEF-${universal}.${side.toUpperCase()}`;
}
for (const finger of ['index', 'middle', 'pinky', 'ring', 'thumb']) for (let joint = 1; joint <= 3; joint++) for (const side of ['l', 'r']) {
  names[`${finger}_0${joint}_${side}`] = `DEF-${finger === 'thumb' ? '' : 'f_'}${finger}.0${joint}.${side.toUpperCase()}`;
}
for (const name in names) names[name] = THREE.PropertyBinding.sanitizeNodeName(names[name]);
const selections = { Idle_Loop: 'idle', Idle_Torch_Loop: 'torch', Walk_Loop: 'walk', Sprint_Loop: 'run', Interact: 'interact', Punch_Cross: 'attack', Hit_Chest: 'reveal', Death01: 'death' };
const clips = [];
for (const [name, output] of Object.entries(selections)) {
  const original = library.animations.find(a => a.name === name);
  if (!original) throw new Error(`Missing animation ${name}`);
  const clip = retargetClip(target, source, original, { names, hip: names.pelvis, scale: 1.035, fps: 30, preserveBonePositions: true, hipInfluence: new THREE.Vector3(0, 1, 0) });
  clip.name = output;
  for (const track of clip.tracks) track.name = track.name.replace(/^\.bones\[([^\]]+)\]/, '$1');
  clip.optimize(); clips.push(clip);
  console.log(output, clip.duration.toFixed(2), clip.tracks.length);
}
target.skeleton.pose(); body.scene.updateMatrixWorld(true);
body.scene.name = 'Explorer';
body.scene.traverse(o => {
  if (!o.isMesh) return;
  o.geometry.deleteAttribute('color');
  o.geometry.deleteAttribute('color_1');
  o.castShadow = o.receiveShadow = true;
  if (o === target) {
    o.name = 'Explorer_Suit';
    const position = o.geometry.attributes.position;
    // Relax the muscular base into padded workwear while retaining one continuous skin.
    // Weld UV seams for the smoothing neighbourhood, never the UVs or skin weights.
    const keys = new Map(), unique = [], vertexToUnique = [];
    for (let i = 0; i < position.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(position, i), key = p.toArray().map(n => Math.round(n * 100000)).join(',');
      if (!keys.has(key)) { keys.set(key, unique.length); unique.push(p); }
      vertexToUnique.push(keys.get(key));
    }
    const neighbours = unique.map(() => new Set());
    const indices = o.geometry.index;
    for (let i = 0; i < indices.count; i += 3) {
      const face = [0, 1, 2].map(j => vertexToUnique[indices.getX(i + j)]);
      for (const a of face) for (const b of face) if (a !== b) neighbours[a].add(b);
    }
    for (let pass = 0; pass < 6; pass++) {
      const next = unique.map((p, i) => {
        if (p.y < .21 || p.y > 1.52 || Math.abs(p.x) > .74 || !neighbours[i].size) return p.clone();
        const average = new THREE.Vector3(); for (const n of neighbours[i]) average.add(unique[n]);
        return p.clone().lerp(average.divideScalar(neighbours[i].size), .48);
      });
      unique.splice(0, unique.length, ...next);
    }
    for (let i = 0; i < position.count; i++) position.setXYZ(i, ...unique[vertexToUnique[i]].toArray());
    o.geometry.computeVertexNormals();
    const normal = o.geometry.attributes.normal;
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i), x = position.getX(i), z = position.getZ(i);
      const cloth = y > .20 && y < 1.53 && Math.abs(x) < .74;
      const hood = y > 1.53 && (z < .025 || y > 1.74);
      const padding = cloth ? .024 : hood ? .012 : y < .20 ? .01 : 0;
      position.setXYZ(i, x + normal.getX(i) * padding, Math.max(-.002, y + normal.getY(i) * padding), z + normal.getZ(i) * padding);
    }
    position.needsUpdate = true;
    o.geometry.computeVertexNormals();
  }
});
mkdirSync('public/models', { recursive: true });
const glb = await new GLTFExporter().parseAsync(body.scene, { binary: true, animations: clips, onlyVisible: false });
writeFileSync('public/models/explorer.glb', Buffer.from(glb));
writeFileSync('public/models/CC0-1.0.txt', readFileSync(root + 'LICENSE'));
writeFileSync('public/models/Quaternius-Standard-License.txt', readFileSync(root + 'License_Standard.txt'));
console.log(`Explorer GLB: ${(glb.byteLength / 1024).toFixed(0)} KiB; continuous body, ${target.skeleton.bones.length} bones, ${clips.length} animation clips.`);
