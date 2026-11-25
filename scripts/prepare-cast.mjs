/* Optional art-source tool for the prologue cast. Finished GLBs are checked in under public/models.
 * Inputs: Quaternius Universal Base Characters + Universal Animation Library (CC0) in .cache/character-source,
 * downloaded by scripts/fetch-character-sources.mjs. Textures are baked by scripts/paint-cast.py.
 * Output: cast-male.glb (three hairstyles + beard, chosen at runtime) and cast-female.glb (long hair).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { retargetClip } from 'three/addons/utils/SkeletonUtils.js';
import { readFileSync, writeFileSync } from 'node:fs';

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

const library = await load('AnimationLibrary_Godot_Standard.gltf');
let source; library.scene.traverse(o => { if (o.isSkinnedMesh) source ??= o; });
const names = { root: 'root', pelvis: 'DEF-hips', spine_01: 'DEF-spine.001', spine_02: 'DEF-spine.002', spine_03: 'DEF-spine.003', neck_01: 'DEF-neck', Head: 'DEF-head' };
for (const [ue, universal] of [['clavicle', 'shoulder'], ['upperarm', 'upper_arm'], ['lowerarm', 'forearm'], ['hand', 'hand'], ['thigh', 'thigh'], ['calf', 'shin'], ['foot', 'foot'], ['ball', 'toe']]) {
  for (const side of ['l', 'r']) names[`${ue}_${side}`] = `DEF-${universal}.${side.toUpperCase()}`;
}
for (const finger of ['index', 'middle', 'pinky', 'ring', 'thumb']) for (let joint = 1; joint <= 3; joint++) for (const side of ['l', 'r']) {
  names[`${finger}_0${joint}_${side}`] = `DEF-${finger === 'thumb' ? '' : 'f_'}${finger}.0${joint}.${side.toUpperCase()}`;
}
for (const name in names) names[name] = THREE.PropertyBinding.sanitizeNodeName(names[name]);
// Civilian set for the prologue: everyday idle/talk/walk/jog, the crouched "creature" creep of the
// amateur monster take, a reaching gesture for the director's "back up" and a startled flinch.
const selections = { Idle_Loop: 'idle', Idle_Talking_Loop: 'talk', Walk_Loop: 'walk', Jog_Fwd_Loop: 'jog', Crouch_Fwd_Loop: 'creep', Crouch_Idle_Loop: 'crouch', Interact: 'interact', Hit_Chest: 'startle' };

/** Per-region weld-aware smoothing and cloth padding of the continuous skin. */
function dress(mesh, regions) {
  const position = mesh.geometry.attributes.position;
  const keys = new Map(), unique = [], toUnique = [];
  for (let i = 0; i < position.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(position, i), key = p.toArray().map(n => Math.round(n * 100000)).join(',');
    if (!keys.has(key)) { keys.set(key, unique.length); unique.push(p); }
    toUnique.push(keys.get(key));
  }
  const neighbours = unique.map(() => new Set()), index = mesh.geometry.index;
  for (let i = 0; i < index.count; i += 3) {
    const face = [0, 1, 2].map(j => toUnique[index.getX(i + j)]);
    for (const a of face) for (const b of face) if (a !== b) neighbours[a].add(b);
  }
  // Reshape the superhero proportions toward ordinary people: thinner limbs, flatter chest, narrower lats.
  const bins = new Map();
  for (const p of unique) if (Math.abs(p.x) > .24 && Math.abs(p.x) < .64 && p.y > 1.2) {
    const key = Math.sign(p.x) * Math.round(Math.abs(p.x) / .02), bin = bins.get(key) ?? { y: 0, z: 0, n: 0 };
    bin.y += p.y; bin.z += p.z; bin.n++; bins.set(key, bin);
  }
  for (const p of unique) {
    const ax = Math.abs(p.x);
    if (ax > .24 && ax < .64 && p.y > 1.2) {
      const bin = bins.get(Math.sign(p.x) * Math.round(ax / .02)), k = regions.arm * (ax > .58 ? 1 + (ax - .58) / .06 * (1 / regions.arm - 1) : 1);
      p.y = bin.y / bin.n + (p.y - bin.y / bin.n) * k; p.z = bin.z / bin.n + (p.z - bin.z / bin.n) * k;
    } else if (p.y > 1.02 && p.y < 1.48 && ax < .24) {
      const w = Math.sin(Math.min(1, (p.y - 1.02) / .46) * Math.PI);
      if (p.z > -.02) p.z = -.02 + (p.z + .02) * (1 - (1 - regions.chest) * w);
      if (ax > .08) p.x = Math.sign(p.x) * (.08 + (ax - .08) * (1 - (1 - regions.lats) * w));
    }
  }
  // Soften the superhero musculature into ordinary bodies (torso and limbs only, never face/hands).
  for (let pass = 0; pass < regions.smoothPasses; pass++) {
    const next = unique.map((p, i) => {
      if (!regions.smooth(p) || !neighbours[i].size) return p.clone();
      const average = new THREE.Vector3(); for (const n of neighbours[i]) average.add(unique[n]);
      return p.clone().lerp(average.divideScalar(neighbours[i].size), .42);
    });
    unique.splice(0, unique.length, ...next);
  }
  for (let i = 0; i < position.count; i++) position.setXYZ(i, ...unique[toUnique[i]].toArray());
  mesh.geometry.computeVertexNormals();
  const normal = mesh.geometry.attributes.normal;
  for (let i = 0; i < position.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(position, i), pad = regions.pad(p);
    if (pad) position.setXYZ(i, p.x + normal.getX(i) * pad, Math.max(-.002, p.y + normal.getY(i) * pad), p.z + normal.getZ(i) * pad);
  }
  position.needsUpdate = true; mesh.geometry.computeVertexNormals();
}

async function build({ file, output, scale, hair, regions }) {
  const body = await load(file);
  let target; body.scene.traverse(o => { if (o.isSkinnedMesh && /SuperHero/i.test(o.name)) target = o; });
  const clips = [];
  for (const [name, out] of Object.entries(selections)) {
    const original = library.animations.find(a => a.name === name);
    const clip = retargetClip(target, source, original, { names, hip: names.pelvis, scale, fps: 30, preserveBonePositions: true, hipInfluence: new THREE.Vector3(0, 1, 0) });
    clip.name = out;
    for (const track of clip.tracks) track.name = track.name.replace(/^\.bones\[([^\]]+)\]/, '$1');
    clip.optimize(); clips.push(clip);
  }
  target.skeleton.pose(); body.scene.updateMatrixWorld(true);
  body.scene.name = 'Civilian';
  body.scene.traverse(o => {
    if (!o.isMesh) return;
    o.geometry.deleteAttribute('color'); o.geometry.deleteAttribute('color_1');
    for (const extra of ['uv1', 'uv2', 'uv3']) o.geometry.deleteAttribute(extra);
    if (o === target) { o.name = 'Cast_Body'; dress(o, regions); }
  });
  const head = target.skeleton.bones.find(b => b.name === 'Head');
  for (const name of hair) {
    const part = await load(`${name}.gltf`);
    let strand; part.scene.traverse(o => { if (o.isMesh) strand ??= o; });
    part.scene.updateMatrixWorld(true);
    const geometry = strand.geometry.clone().applyMatrix4(strand.matrixWorld);
    for (const extra of ['color', 'color_1', 'uv1', 'uv2', 'uv3', 'tangent']) geometry.deleteAttribute(extra);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ name: 'MI_Hair', side: THREE.DoubleSide }));
    mesh.name = name;
    // "Origin at 0" hair is modelled in the bind-pose space of the body; parent it to the head bone.
    mesh.applyMatrix4(head.matrixWorld.clone().invert()); head.add(mesh);
  }
  const glb = await new GLTFExporter().parseAsync(body.scene, { binary: true, animations: clips, onlyVisible: false });
  writeFileSync(`public/models/${output}`, Buffer.from(glb));
  console.log(`${output}: ${(glb.byteLength / 1024).toFixed(0)} KiB, ${target.skeleton.bones.length} bones, ${clips.length} clips, hair ${hair.join(', ')}`);
}

await build({
  file: 'Superhero_Male_FullBody.gltf', output: 'cast-male.glb', scale: 1.035,
  hair: ['Hair_SimpleParted', 'Hair_Buzzed', 'Hair_Beard'],
  regions: {
    smoothPasses: 4, arm: .84, chest: .8, lats: .82,
    smooth: p => p.y > .22 && p.y < 1.5 && Math.abs(p.x) < .6,
    // T-shirt (to mid upper arm) and trousers get a little volume over the skin.
    pad: p => (p.y > .99 && p.y < 1.49 && Math.abs(p.x) < .36) ? .011 : (p.y > .1 && p.y <= .99 && Math.abs(p.x) < .3) ? .008 : 0,
  },
});
await build({
  file: 'Superhero_Female_FullBody.gltf', output: 'cast-female.glb', scale: 1.035 * .932 / .949,
  hair: ['Hair_Long'],
  regions: {
    smoothPasses: 3, arm: .9, chest: .92, lats: .9,
    smooth: p => p.y > .22 && p.y < 1.45 && Math.abs(p.x) < .55,
    // Loose hoodie to the wrists and jeans.
    pad: p => (p.y > .96 && p.y < 1.46 && Math.abs(p.x) < .62) ? .018 : (p.y > .09 && p.y <= .96 && Math.abs(p.x) < .3) ? .008 : 0,
  },
});
