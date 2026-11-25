import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { labelTexture } from './textures';
import { seededRandom } from './level';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paintedSteel, bareMetal, moulded, porcelain, upholstery, cardboard, shippingLabel, notePaper, hardboard, wiredGlass, exitSignTexture, warningSticker, isSharedMaterial } from './materials';

export function wornMetalTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#a5a69b'; ctx.fillRect(0, 0, 256, 256);
  const random = seededRandom(981);
  for (let i = 0; i < 2800; i++) {
    ctx.fillStyle = `rgba(${random() > .5 ? '240,239,220' : '35,39,34'},${random() * .16})`;
    ctx.fillRect(random() * 256, random() * 256, 1 + random() * 18, .3 + random());
  }
  for (let i = 0; i < 30; i++) {
    ctx.strokeStyle = 'rgba(28,32,27,.2)'; ctx.lineWidth = .4;
    ctx.beginPath(); const x = random() * 256, y = random() * 256;
    ctx.moveTo(x, y); ctx.lineTo(x + random() * 80 - 40, y + random() * 50); ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 4;
  return texture;
}
const rounded = (w: number, h: number, d: number, r = .025) => new RoundedBoxGeometry(w, h, d, 2, r);
function part(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function lathe(profile: number[][], material: THREE.Material, parent: THREE.Object3D) {
  return part(new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 28), material, parent);
}

/** A shaped, turned-metal torch; shared visual design in first and third person. Axis is -Z. */
export function createTorch() {
  const torch = new THREE.Group(); torch.name = 'MachinedFlashlight';
  const wear = wornMetalTexture();
  const metal = new THREE.MeshStandardMaterial({ color: 0x424a42, map: wear, bumpMap: wear, bumpScale: .0011, metalness: .72, roughness: .38 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x242b24, roughness: .92 });
  const silver = new THREE.MeshStandardMaterial({ color: 0xc2c2af, metalness: .92, roughness: .23 });
  const body = lathe([[0, -.13], [.031, -.13], [.034, -.115], [.034, .075], [.04, .095], [.057, .14], [.058, .17], [.052, .175], [0, .175]], metal, torch);
  body.rotation.x = -Math.PI / 2;
  for (let i = 0; i < 10; i++) part(new THREE.TorusGeometry(.0345, .0018, 5, 28), rubber, torch, 0, 0, -.06 + i * .017);
  part(new THREE.TorusGeometry(.055, .003, 8, 28), silver, torch, 0, 0, -.174);
  const reflector = lathe([[0, 0], [.014, 0], [.049, .018], [.052, .022]], silver, torch); reflector.rotation.x = -Math.PI / 2; reflector.position.z = -.15;
  part(new THREE.CircleGeometry(.049, 28), new THREE.MeshPhysicalMaterial({ color: 0xbcc5ad, transparent: true, opacity: .32, metalness: .18, roughness: .12, clearcoat: 1 }), torch, 0, 0, -.177).rotation.y = Math.PI;
  part(new THREE.CircleGeometry(.009, 16), new THREE.MeshBasicMaterial({ color: 0xffedba }), torch, 0, 0, -.157).rotation.y = Math.PI;
  part(rounded(.016, .006, .03, .003), rubber, torch, 0, .035, -.005);
  const label = part(new THREE.PlaneGeometry(.043, .018), new THREE.MeshBasicMaterial({ map: labelTexture('NOCLIP', '#b7bba4', '#32392d') }), torch, .0345, .005, .036);
  label.rotation.y = Math.PI / 2;
  return torch;
}

type Geo = THREE.BufferGeometry;
/** Several parts with one material become one draw call. */
function merged(geometries: Geo[], material: THREE.Material, parent: THREE.Object3D, shadows = true) {
  const geometry = mergeGeometries(geometries.map(g => g.index ? g.toNonIndexed() : g)); geometries.forEach(g => g.dispose());
  const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = shadows; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const rbox = (w: number, h: number, d: number, r: number, x = 0, y = 0, z = 0, segments = 2) => new RoundedBoxGeometry(w, h, d, segments, r).translate(x, y, z);
const cyl = (rt: number, rb: number, h: number, x = 0, y = 0, z = 0, radial = 18) => new THREE.CylinderGeometry(rt, rb, h, radial).translate(x, y, z);
/** Slotted screw head facing +Z. */
function screwHeads(points: [number, number, number][], radius: number, material: THREE.Material, parent: THREE.Object3D, facing: 'z' | 'y' = 'z') {
  const heads: Geo[] = [], slots: Geo[] = [];
  for (const [x, y, z] of points) {
    const head = new THREE.SphereGeometry(radius, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.4); head.scale(1, .45, 1);
    const slot = new THREE.BoxGeometry(radius * 1.8, radius * .5, radius * .28);
    if (facing === 'z') { head.rotateX(Math.PI / 2); slot.translate(0, radius * .3, 0); slot.rotateX(Math.PI / 2); slot.rotateZ((Math.abs(x * 37 + y * 11) % 1) * 3); }
    else slot.translate(0, radius * .35, 0);
    head.translate(x, y, z); slot.translate(x, y, z); heads.push(head); slots.push(slot);
  }
  merged(heads, material, parent, false); merged(slots, new THREE.MeshBasicMaterial({ color: 0x15140f }), parent, false);
}
/** Gentle pillow: vertices on the +Y side rise towards the centre. */
function puff(geometry: Geo, width: number, depth: number, amount: number, axis: 'y' | 'z' = 'y') {
  const position = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i) / (width / 2), other = axis === 'y' ? position.getZ(i) / (depth / 2) : position.getY(i) / (depth / 2);
    const fall = Math.max(0, 1 - x * x) * Math.max(0, 1 - other * other);
    if (axis === 'y' && position.getY(i) > 0) position.setY(i, position.getY(i) + fall * amount);
    if (axis === 'z' && position.getZ(i) > 0) position.setZ(i, position.getZ(i) + fall * amount);
  }
  geometry.computeVertexNormals(); return geometry;
}
/** Curves a part around the Y axis (chair backs, curled paper). */
function bendZ(geometry: Geo, curvature: number) {
  const position = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) position.setZ(i, position.getZ(i) - position.getX(i) * position.getX(i) * curvature);
  geometry.computeVertexNormals(); return geometry;
}

/** A 16 A ceramic cartridge fuse resting in a porcelain fuse base with brass spring clips. */
export function createFuse(index: number) {
  const group = new THREE.Group(); group.name = `CeramicFuse-${index}`;
  const brass = bareMetal('brass', 11 + index), base = porcelain(21), steel = bareMetal('steel', 4);
  const bakelite = moulded('#2a2622', 3, .42);
  merged([rbox(.36, .045, .16, .012, 0, -.112, 0, 3)], base, group);
  merged([rbox(.32, .012, .12, .004, 0, -.084, 0)], bakelite, group);
  const clips: Geo[] = [];
  for (const side of [-1, 1]) {
    for (const z of [-.031, .031]) { const leaf = new THREE.CylinderGeometry(.04, .04, .045, 16, 1, true, 0, Math.PI * .62); leaf.rotateZ(Math.PI / 2); leaf.rotateX(z < 0 ? Math.PI * .69 : -Math.PI * .31 + Math.PI); leaf.translate(side * .11, -.035, 0); clips.push(leaf); }
    clips.push(box(.05, .012, .07, side * .11, -.075, 0), box(.05, .02, .03, side * .155, -.07, 0));
  }
  merged(clips, brass, group);
  screwHeads([[-.155, -.058, 0], [.155, -.058, 0], [-.16, -.088, .065], [.16, -.088, -.065]], .009, steel, group, 'y');
  const cartridge = new THREE.Group(); cartridge.rotation.z = Math.PI / 2; cartridge.position.y = -.035; group.add(cartridge);
  lathe([[0, -.1], [.03, -.1], [.033, -.093], [.033, .093], [.03, .1], [0, .1]], porcelain(23), cartridge);
  const ferrules: Geo[] = [];
  for (const side of [-1, 1]) {
    ferrules.push(cyl(.0365, .0365, .05, 0, side * .11), cyl(.0345, .0345, .006, 0, side * .138));
    for (let k = 0; k < 4; k++) { const ring = new THREE.TorusGeometry(.0366, .0012, 4, 28); ring.rotateX(Math.PI / 2); ring.translate(0, side * (.092 + k * .011), 0); ferrules.push(ring); }
  }
  merged(ferrules, brass, cartridge);
  const striker = part(cyl(.008, .008, .006, 0, .143, 0, 12), new THREE.MeshStandardMaterial({ color: 0xa2382a, roughness: .5 }), cartridge); striker.name = 'FuseIndicator';
  const label = document.createElement('canvas'); label.width = 512; label.height = 128; const l = label.getContext('2d')!;
  l.fillStyle = '#d9d4ba'; l.fillRect(0, 0, 512, 128); l.fillStyle = '#2b2e2a'; l.font = '700 46px sans-serif'; l.fillText(`ПН-2  16 А`, 20, 56); l.font = '500 28px monospace'; l.fillText(`500 В ~  gG  · 0${index + 1}`, 20, 104);
  l.fillStyle = '#9c3a2a'; l.fillRect(430, 0, 24, 128);
  const labelMap = new THREE.CanvasTexture(label); labelMap.colorSpace = THREE.SRGBColorSpace;
  const band = new THREE.CylinderGeometry(.0335, .0335, .1, 32, 1, true, -Math.PI * .55, Math.PI * 1.1); band.rotateY(Math.PI);
  part(band, new THREE.MeshStandardMaterial({ map: labelMap, roughness: .7 }), cartridge);
  const led = part(new THREE.SphereGeometry(.009, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffba69 }), group, .15, -.08, .062);
  led.name = 'PickupLED';
  const beacon = new THREE.PointLight(0xffba70, .75, 2.2, 1.8); beacon.position.y = .16; group.add(beacon);
  return group;
}

/**
 * Wall-mounted distribution cabinet with its door swung open: DIN-rail breakers, three empty
 * porcelain fuse bases, signal lamps, a knife-switch main lever and conduits to the ceiling.
 */
export function createSwitchboard(conduitLength = 1.12) {
  const group = new THREE.Group(); group.name = 'IndustrialSwitchboard';
  const paint = paintedSteel('#6b7566', 41, .55), zinc = bareMetal('zinc', 6), copper = bareMetal('copper', 8), brass = bareMetal('brass', 9);
  const white = moulded('#bcb7a5', 12, .45), black = moulded('#1d1f1c', 14, .5), base = porcelain(31);
  const W = .78, H = .94, D = .2, t = .018;
  merged([box(W, H, t, 0, 0, -D / 2 + t / 2), box(W, t, D, 0, H / 2 - t / 2, 0), box(W, t, D, 0, -H / 2 + t / 2, 0), box(t, H, D, -W / 2 + t / 2, 0, 0), box(t, H, D, W / 2 - t / 2, 0, 0),
    box(W + .02, .025, .012, 0, H / 2 - .012, D / 2), box(W + .02, .025, .012, 0, -H / 2 + .012, D / 2), box(.025, H, .012, -W / 2 + .012, 0, D / 2), box(.025, H, .012, W / 2 - .012, 0, D / 2)], paint, group);
  merged([box(W - .06, H - .06, .004, 0, 0, -D / 2 + t + .004)], zinc, group);
  // Door on the left hinge, opened ~150° so it lies back towards the wall.
  const hinge = new THREE.Group(); hinge.position.set(-W / 2 - .006, 0, D / 2 + .01); hinge.rotation.y = -2.6; group.add(hinge);
  merged([rbox(W, H, .022, .006, W / 2, 0, 0)], paint, hinge);
  merged([rbox(W - .1, H - .1, .01, .004, W / 2, 0, -.013)], paint, hinge);
  const lockGeo = [cyl(.016, .016, .02, 0, 0, 0, 16).rotateX(Math.PI / 2).translate(W - .05, 0, .016)];
  merged(lockGeo, bareMetal('chrome', 2), hinge);
  const diagram = document.createElement('canvas'); diagram.width = 256; diagram.height = 320; const d = diagram.getContext('2d')!;
  d.fillStyle = '#cdc7ad'; d.fillRect(0, 0, 256, 320); d.strokeStyle = '#2e3029'; d.lineWidth = 2; d.font = '600 16px monospace'; d.fillStyle = '#2e3029'; d.fillText('СХЕМА ЩР-0', 20, 30);
  d.beginPath(); d.moveTo(40, 60); d.lineTo(40, 280); for (let i = 0; i < 6; i++) { d.moveTo(40, 80 + i * 34); d.lineTo(200, 80 + i * 34); d.strokeRect(120, 72 + i * 34, 30, 16); d.fillText(`QF${i + 1}`, 160, 86 + i * 34); } d.stroke();
  const diagramMap = new THREE.CanvasTexture(diagram); diagramMap.colorSpace = THREE.SRGBColorSpace;
  const sheet = part(new THREE.PlaneGeometry(.3, .38), new THREE.MeshStandardMaterial({ map: diagramMap, roughness: .9 }), hinge, W / 2, .05, -.019); sheet.rotation.y = Math.PI;
  for (const y of [-.36, 0, .36]) part(cyl(.012, .012, .07, 0, y, 0, 12), zinc, hinge, .006, 0, 0);
  // DIN rail with modular breakers.
  merged([box(W - .1, .035, .008, 0, .3, -D / 2 + .03)], zinc, group);
  const breakers: Geo[] = [], toggles: Geo[] = [];
  for (let i = 0; i < 12; i++) { const x = -.3 + i * .054; breakers.push(rbox(.05, .1, .07, .004, x, .3, -D / 2 + .065), box(.05, .02, .062, x, .36, -D / 2 + .06)); toggles.push(rbox(.014, .03, .02, .003, x, .3 + (i % 5 === 2 ? -.012 : .012), -D / 2 + .108)); }
  merged(breakers, white, group); merged(toggles, black, group);
  part(new THREE.PlaneGeometry(.66, .022), new THREE.MeshBasicMaterial({ map: labelTexture('QF1  QF2  QF3  QF4  QF5  QF6  QF7  QF8', '#2f322b', '#cbc6ab', 1024, 40) }), group, 0, .23, -D / 2 + .1);
  // Three fuse bases waiting for the recovered fuses, each with its own signal lamp.
  const lamps: THREE.Mesh[] = [], clips: Geo[] = [], bases: Geo[] = [], bezels: Geo[] = [];
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * .19;
    bases.push(rbox(.13, .27, .05, .01, x, -.06, -D / 2 + .05, 3));
    for (const side of [-1, 1]) { clips.push(box(.04, .03, .04, x, -.06 + side * .085, -D / 2 + .09), cyl(.007, .007, .04, x - .02, -.06 + side * .085, -D / 2 + .09).rotateZ(0)); }
    bezels.push(cyl(.022, .022, .014, x, .14, -D / 2 + .03).rotateX(Math.PI / 2).translate(0, 0, 0));
    const lamp = part(new THREE.SphereGeometry(.016, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x743b28 }), group, x, .14, -D / 2 + .045);
    lamp.rotation.x = Math.PI / 2; lamps.push(lamp);
    part(new THREE.PlaneGeometry(.1, .03), new THREE.MeshBasicMaterial({ map: labelTexture(`F${i + 1}  16A`, '#2c2f29', '#cfcab0') }), group, x, -.225, -D / 2 + .077);
  }
  merged(bases, base, group); merged(clips, brass, group);
  const bezelMesh = merged(bezels, bareMetal('chrome', 4), group); bezelMesh.position.z = 0;
  // Wiring loom from breakers to fuse bases.
  const wires = [0xa33b2a, 0x2c4f8a, 0xc9b24a, 0x1d1d1a];
  wires.forEach((color, i) => {
    const x = -.2 + i * .13, curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x, .25, -D / 2 + .04), new THREE.Vector3(x * .7, .19, -D / 2 + .03), new THREE.Vector3((i - 1.5) * .12, .08, -D / 2 + .035), new THREE.Vector3((Math.min(i, 2) - 1) * .19, .035, -D / 2 + .06)]);
    part(new THREE.TubeGeometry(curve, 16, .0055, 6, false), new THREE.MeshStandardMaterial({ color, roughness: .55 }), group);
  });
  // Main knife switch: lever pivots on X; game rotates `lever`.
  merged([rbox(.07, .16, .04, .008, .31, -.1, -D / 2 + .04)], black, group);
  const lever = new THREE.Group(); lever.position.set(.31, -.03, -D / 2 + .07); group.add(lever);
  merged([box(.012, .16, .02, -.022, -.07, .01), box(.012, .16, .02, .022, -.07, .01)], copper, lever);
  part(cyl(.017, .017, .085, 0, -.15, .02, 16).rotateZ(Math.PI / 2), moulded('#7a2a1f', 15, .35), lever);
  // Exterior: signal lamp, warning sticker and conduits to the ceiling.
  merged([cyl(.03, .03, .02, .3, H / 2 + .01, .03, 18)], bareMetal('chrome', 5), group);
  const indicator = part(new THREE.SphereGeometry(.022, 16, 10), new THREE.MeshBasicMaterial({ color: 0xb95832 }), group, .3, H / 2 + .03, .03);
  const sticker = part(new THREE.PlaneGeometry(.2, .1), warningSticker(), group, -.18, .4, D / 2 + .007);
  sticker.rotation.z = -.02;
  const conduits: Geo[] = [], clamps: Geo[] = [];
  for (const x of [-.24, -.08, .14]) {
    conduits.push(cyl(.016, .016, conduitLength, x, H / 2 + conduitLength / 2, -.04, 14));
    for (const y of [.18, .62]) clamps.push(box(.05, .022, .03, x, H / 2 + y, -.055));
    conduits.push(cyl(.022, .022, .03, x, H / 2 + .015, -.04, 14));
  }
  merged(conduits, zinc, group); merged(clamps, paint, group);
  return { group, indicator, lamps, lever };
}

/** Clipboard of handwritten field notes, with spring clip and a dropped pen. */
export function createArchive(index: number, title = `ЗАПИСЬ 0${index + 1}`, text = '') {
  const group = new THREE.Group(); group.name = 'RecoveredFieldNotes';
  merged([rbox(.24, .007, .335, .006, 0, 0, 0, 3)], hardboard(), group);
  const words = text.split(/\s+/).filter(Boolean), lines: string[] = []; let line = '';
  for (const word of words) { if ((line + ' ' + word).length > 30) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word; }
  if (line) lines.push(line);
  const paper = notePaper(index, title, lines.slice(0, 16));
  for (let s = 0; s < 3; s++) {
    const sheet = new THREE.PlaneGeometry(.215, .295, 6, 8); sheet.rotateX(-Math.PI / 2);
    const position = sheet.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) { const x = position.getX(i), z = position.getZ(i); const curl = Math.max(0, (x + z * .6 - .08) * 1.6); position.setY(i, curl * curl * (s === 0 ? .9 : .5)); }
    sheet.computeVertexNormals(); sheet.translate((s - 1) * .004, .005 + s * .0012, .012 - s * .003); sheet.rotateY((s - 1) * .025);
    const mesh = part(sheet, s === 2 ? paper : notePaper(index + 10 + s, '', []), group); mesh.castShadow = false;
  }
  const chrome = bareMetal('chrome', 7);
  merged([rbox(.09, .006, .03, .003, 0, .012, -.15), cyl(.004, .004, .1, 0, .02, -.15, 10).rotateZ(Math.PI / 2)], chrome, group);
  const leverCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(-.035, .02, -.15), new THREE.Vector3(-.03, .036, -.165), new THREE.Vector3(0, .042, -.172), new THREE.Vector3(.03, .036, -.165), new THREE.Vector3(.035, .02, -.15)]);
  part(new THREE.TubeGeometry(leverCurve, 16, .0025, 6, false), chrome, group);
  screwHeads([[-.03, .007, -.15], [.03, .007, -.15]], .004, chrome, group, 'y');
  const pen = new THREE.Group(); pen.position.set(.15, .006, .05); pen.rotation.set(0, .5, Math.PI / 2); group.add(pen);
  lathe([[0, -.07], [.002, -.07], [.0045, -.06], [.0045, .05], [.004, .062], [0, .066]], moulded('#2d3f72', 16, .3), pen);
  part(new THREE.CylinderGeometry(.0028, .0028, .04, 10).translate(.006, .035, 0), chrome, pen);
  return group;
}

/** Swivel office chair: five-star base, twin casters, gas lift, padded seat and curved back. */
export function createOfficeChair(seed = 1) {
  const chair = new THREE.Group(); chair.name = 'OfficeChair';
  const fabric = upholstery('#3a3d33', 9 + seed), plastic = moulded('#1f211e', 20 + seed, .55), chrome = bareMetal('chrome', 3), dark = bareMetal('steel', 12);
  const legs: Geo[] = [], wheels: Geo[] = [], forks: Geo[] = [];
  for (let i = 0; i < 5; i++) {
    const leg = new THREE.BoxGeometry(.05, .034, .3, 1, 1, 6), position = leg.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < position.count; v++) { const z = position.getZ(v) / .3 + .5, taper = 1 - z * .45; position.setX(v, position.getX(v) * taper); position.setY(v, position.getY(v) * taper - z * z * .02); }
    leg.computeVertexNormals(); leg.translate(0, .1, .17); leg.rotateY(i * Math.PI * 2 / 5); legs.push(leg);
    const a = i * Math.PI * 2 / 5, x = Math.sin(a) * .31, z = Math.cos(a) * .31;
    forks.push(rbox(.035, .04, .04, .008, x, .07, z));
    for (const side of [-1, 1]) wheels.push(new THREE.CylinderGeometry(.025, .025, .014, 18).rotateZ(Math.PI / 2).rotateY(a).translate(x + Math.cos(a) * side * .011, .028, z - Math.sin(a) * side * .011));
  }
  legs.push(cyl(.05, .062, .06, 0, .11, 0, 20));
  merged(legs, plastic, chair); merged(forks, plastic, chair); merged(wheels, moulded('#141513', 22, .7), chair);
  const sleeve = lathe([[.03, .14], [.03, .17], [.027, .18], [.027, .2], [.03, .21], [.03, .24], [.027, .25], [.027, .3], [.024, .31], [0, .31]], plastic, chair); sleeve.castShadow = true;
  merged([cyl(.014, .014, .1, 0, .35, 0, 16)], chrome, chair);
  merged([rbox(.2, .035, .22, .01, 0, .41, 0), cyl(.012, .012, .1, .12, .4, -.02, 10).rotateZ(0)], dark, chair);
  merged([cyl(.022, .022, .03, 0, 0, 0, 14).rotateX(Math.PI / 2).translate(0, .4, .125)], plastic, chair);
  merged([rbox(.47, .03, .46, .012, 0, .44, 0, 3)], plastic, chair);
  merged([puff(new RoundedBoxGeometry(.46, .075, .45, 5, .032), .46, .45, .018).translate(0, .49, 0)], fabric, chair);
  const spine = new THREE.CatmullRomCurve3([new THREE.Vector3(0, .42, -.12), new THREE.Vector3(0, .43, -.25), new THREE.Vector3(0, .52, -.29), new THREE.Vector3(0, .66, -.29)]);
  part(new THREE.TubeGeometry(spine, 18, .022, 8, false), dark, chair);
  const back = bendZ(puff(new RoundedBoxGeometry(.44, .5, .07, 5, .03), .44, .5, .014, 'z'), .5);
  merged([back.translate(0, .82, -.27)], fabric, chair);
  merged([bendZ(new RoundedBoxGeometry(.42, .46, .02, 3, .009), .5).translate(0, .82, -.31)], plastic, chair);
  for (const side of [-1, 1]) {
    merged([rbox(.03, .22, .05, .008, side * .25, .56, -.02), rbox(.03, .025, .2, .008, side * .25, .45, -.02)], plastic, chair);
    merged([rbox(.07, .035, .25, .016, side * .25, .68, -.02, 3)], moulded('#232521', 24, .65), chair);
  }
  return chair;
}

/**
 * Corrugated box with soft bulges, dents, flaps and tape. Closed boxes have a flat top for
 * objectives; open ones show a darker interior and splayed flaps.
 */
export function createCardboardBox(width: number, height: number, depth: number, seed = 1, open = false) {
  const group = new THREE.Group(); group.name = open ? 'OpenCardboardBox' : 'CardboardBox';
  const random = seededRandom(seed * 7919), material = cardboard(seed % 4);
  const body = new THREE.BoxGeometry(width, height, depth, 8, 8, 8), position = body.attributes.position as THREE.BufferAttribute, normal = body.attributes.normal as THREE.BufferAttribute;
  const dents = Array.from({ length: 3 }, () => ({ x: (random() - .5) * width, y: (random() - .2) * height * .7, z: (random() - .5) * depth, r: .08 + random() * .12, a: .01 + random() * .018 }));
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i), nx = normal.getX(i), ny = normal.getY(i), nz = normal.getZ(i);
    if (open && ny > .5) continue;
    const u = Math.abs(nx) > .5 ? z / depth + .5 : x / width + .5, v = Math.abs(ny) > .5 ? z / depth + .5 : y / height + .5;
    const mask = Math.sin(Math.PI * Math.min(1, Math.max(0, u))) * Math.sin(Math.PI * Math.min(1, Math.max(0, v)));
    let push = mask * (ny < -.5 ? 0 : .006 + (ny > .5 ? -.008 : 0));
    for (const dent of dents) { const dist = Math.hypot(x - dent.x, y - dent.y, z - dent.z); push -= dent.a * Math.exp(-(dist * dist) / (dent.r * dent.r)) * mask; }
    position.setXYZ(i, x + nx * push, y + ny * push, z + nz * push);
  }
  body.computeVertexNormals(); body.translate(0, height / 2, 0);
  if (open) {
    // Remove the lid faces (group 2 = +Y) and add an interior shell.
    body.groups = body.groups.filter(g => g.materialIndex !== 2);
    const inner = material.clone(); inner.color.setHex(0x6f6450); inner.side = THREE.BackSide; inner.userData.sharedMaterial = false;
    const shell = new THREE.Mesh(new THREE.BoxGeometry(width - .01, height - .01, depth - .01).translate(0, height / 2 + .005, 0), [inner, inner, new THREE.MeshBasicMaterial({ visible: false }), inner, inner, inner]); group.add(shell);
    const mesh = new THREE.Mesh(body, [material, material, material, material, material, material]); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    const flaps: [number, number, number, number, number][] = [[0, depth / 2, width, depth / 2, 0], [0, -depth / 2, width, depth / 2, Math.PI], [width / 2, 0, depth, width / 2, Math.PI / 2], [-width / 2, 0, depth, width / 2, -Math.PI / 2]];
    for (const [x, z, w, d, yaw] of flaps) {
      const hinge = new THREE.Group(); hinge.position.set(x, height, z); hinge.rotation.y = yaw; group.add(hinge);
      const flap = part(new THREE.BoxGeometry(w * .98, .004, d * .96).translate(0, 0, d * .48), material, hinge); flap.rotation.x = .9 + random() * .9;
    }
  } else {
    const mesh = part(body, material, group); mesh.castShadow = true;
    const seam = part(new THREE.PlaneGeometry(.004, depth * .98).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3a3224 }), group, 0, height + .0015, 0); seam.castShadow = false;
    const tape = new THREE.MeshPhysicalMaterial({ color: 0xb59a5c, roughness: .28, clearcoat: .6, transparent: true, opacity: .86 });
    const strip = new THREE.Group(); group.add(strip);
    part(new THREE.PlaneGeometry(.05, depth + .002).rotateX(-Math.PI / 2), tape, strip, 0, height + .002, 0).castShadow = false;
    for (const side of [-1, 1]) { const end = part(new THREE.PlaneGeometry(.05, .08), tape, strip, 0, height - .04, side * (depth / 2 + .007)); end.rotation.y = side < 0 ? Math.PI : 0; end.castShadow = false; }
  }
  if (random() > .3) { const label = part(new THREE.PlaneGeometry(Math.min(.16, width * .4), Math.min(.1, height * .25)), shippingLabel(seed), group, (random() - .5) * width * .3, height * (.45 + random() * .2), depth / 2 + .009); label.rotation.z = (random() - .5) * .08; label.castShadow = false; }
  return group;
}

/** Steel fire-exit double doors with wired-glass panels, panic bars, closers and a lit sign. */
export function createExitDoor() {
  const group = new THREE.Group(); group.name = 'FireExitDoors';
  const frame = paintedSteel('#3b463a', 51, .45), leaf = paintedSteel('#6e7463', 52, .35), brushed = bareMetal('steel', 15), chrome = bareMetal('chrome', 16);
  merged([box(.1, 2.42, .2, -.73, 1.21, 0), box(.1, 2.42, .2, .73, 1.21, 0), box(1.56, .1, .2, 0, 2.47, 0), box(.02, 2.36, .03, -.67, 1.18, .085), box(.02, 2.36, .03, .67, 1.18, .085), box(1.36, .02, .03, 0, 2.41, .085)], frame, group);
  merged([box(1.5, .012, .14, 0, .006, .05)], bareMetal('zinc', 17), group);
  const glassBack = new THREE.MeshBasicMaterial({ color: 0x0b0d0a });
  for (const side of [-1, 1]) {
    const x = side * .335;
    merged([rbox(.66, 2.36, .05, .008, x, 1.18, .06, 2), rbox(.24, .66, .02, .006, x + side * -.08, 1.62, .093)], leaf, group);
    part(new THREE.PlaneGeometry(.18, .6), glassBack, group, x + side * -.08, 1.62, .104);
    part(new THREE.PlaneGeometry(.18, .6), wiredGlass(), group, x + side * -.08, 1.62, .107).castShadow = false;
    merged([rbox(.07, .09, .06, .012, x + side * .24, 1.0, .115), rbox(.07, .09, .06, .012, x - side * .2, 1.0, .115), rbox(.3, .06, .045, .012, x + side * .02, 1.0, .118)], brushed, group);
    merged([cyl(.018, .018, .5, x + side * .02, 1.0, .14, 14).rotateZ(Math.PI / 2).translate(0, 0, 0)], chrome, group);
    merged([box(.62, .24, .003, x, .2, .087)], brushed, group);
    screwHeads([[x - .29, .3, .089], [x + .29, .3, .089], [x - .29, .1, .089], [x + .29, .1, .089]], .006, chrome, group);
    const hinges: Geo[] = []; for (const y of [.35, 1.2, 2.05]) hinges.push(cyl(.013, .013, .12, side * .665, y, .088, 12));
    merged(hinges, brushed, group);
    merged([rbox(.3, .06, .06, .01, x + side * .08, 2.24, .115), box(.24, .018, .03, x - side * .02, 2.3, .13).rotateY(0)], moulded('#55584f', 30, .45), group);
    const sticker = part(new THREE.PlaneGeometry(.26, .09), new THREE.MeshStandardMaterial({ map: labelTexture(side < 0 ? 'ЗАПАСНЫЙ ВЫХОД' : 'НАЖАТЬ ДЛЯ ВЫХОДА', '#e8e6d6', '#2f6d42', 512, 160), roughness: .6 }), group, x + side * -.08, 1.2, .0865);
    sticker.castShadow = false;
  }
  merged([rbox(1.1, .32, .09, .012, 0, 2.67, .06)], moulded('#d8d6c8', 31, .35), group);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, .27), new THREE.MeshBasicMaterial({ map: exitSignTexture() }));
  sign.position.set(0, 2.67, .107); group.add(sign);
  return { group, sign };
}

/** Return-air ceiling grille: bevelled frame, angled louvres, dark plenum, screws. */
export function createReturnGrille(seed = 1) {
  const group = new THREE.Group(); group.name = 'ReturnGrille';
  const paint = paintedSteel('#b7b49e', 60 + seed, .25);
  const parts: Geo[] = [box(.6, .02, .05, 0, 0, -.275), box(.6, .02, .05, 0, 0, .275), box(.05, .02, .5, -.275, 0, 0), box(.05, .02, .5, .275, 0, 0)];
  for (let i = 0; i < 11; i++) parts.push(new THREE.BoxGeometry(.5, .004, .045).rotateX(.65).translate(0, -.008, -.22 + i * .044));
  merged(parts, paint, group);
  part(new THREE.PlaneGeometry(.5, .5).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x14130e }), group, 0, .02, 0).castShadow = false;
  screwHeads([[-.27, -.011, -.27], [.27, -.011, -.27], [-.27, -.011, .27], [.27, -.011, .27]].map(([x, y, z]) => [x, y, z] as [number, number, number]), .007, bareMetal('steel', 18), group, 'y');
  group.children.slice(-2).forEach(m => { m.rotation.x = Math.PI; m.position.y = -.022; });
  return group;
}

/** Yellowed Schuko-style wall outlet with earthing clips and centre screw. */
export function createWallOutlet() {
  const group = new THREE.Group(); group.name = 'WallOutlet';
  merged([rbox(.085, .085, .012, .012, 0, 0, .006, 3)], moulded('#d4cdb0', 33, .38), group);
  merged([cyl(.026, .026, .008, 0, 0, .009, 24).rotateX(Math.PI / 2).translate(0, 0, 0)], moulded('#bfb79a', 34, .5), group);
  const holes: Geo[] = []; for (const side of [-1, 1]) holes.push(new THREE.CircleGeometry(.0042, 12).translate(side * .0095, 0, .0136));
  merged(holes, new THREE.MeshBasicMaterial({ color: 0x0b0a08 }), group, false);
  merged([box(.008, .004, .004, 0, .024, .013), box(.008, .004, .004, 0, -.024, .013)], bareMetal('zinc', 35), group, false);
  screwHeads([[0, 0, .0136]], .0035, bareMetal('steel', 36), group);
  return group;
}

export function disposeProp(group: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  group.traverse(o => { if (o instanceof THREE.Mesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) { if (isSharedMaterial(m)) continue; materials.add(m); const p = m as THREE.MeshStandardMaterial; for (const t of [p.map, p.bumpMap]) if (t) textures.add(t); } } });
  geometries.forEach(g => g.dispose()); textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose());
}

/** Character accessories are fitted to animated bones, not used to construct the body. */
export function createExplorerGear() {
  const goggles = new THREE.Group(); goggles.name = 'ProtectiveGoggles';
  const dark = new THREE.MeshStandardMaterial({ color: 0x29332c, roughness: .75 });
  part(rounded(.188, .065, .031, .022), dark, goggles, 0, 0, 0);
  part(rounded(.16, .042, .008, .014), new THREE.MeshPhysicalMaterial({ color: 0x374a40, metalness: .25, roughness: .18, clearcoat: .9 }), goggles, 0, .002, .018);
  const strap = part(new THREE.TorusGeometry(.085, .009, 5, 20), dark, goggles, 0, 0, -.075); strap.rotation.x = Math.PI / 2; strap.scale.set(1.04, 1.27, 1);
  const backpack = new THREE.Group(); backpack.name = 'FieldPack';
  const fabric = new THREE.MeshStandardMaterial({ color: 0x555e49, map: wornMetalTexture(), roughness: .98 });
  part(rounded(.31, .41, .145, .055), fabric, backpack);
  part(rounded(.25, .17, .035, .026), fabric, backpack, 0, -.085, -.083);
  part(rounded(.025, .28, .015, .005), dark, backpack, -.10, .005, -.078);
  part(rounded(.025, .28, .015, .005), dark, backpack, .10, .005, -.078);
  return { goggles, backpack };
}

/** Half-litre PET bottle of "almond water": ridged plastic, milky liquid, ribbed cap and wrap label. */
export function createAlmondWater(seed = 1) {
  const group = new THREE.Group(); group.name = 'AlmondWater';
  const profile = [[0, 0], [.03, 0], [.034, .006], [.034, .03], [.031, .036], [.034, .042], [.034, .15], [.03, .17], [.016, .195], [.0125, .2], [.0125, .212]];
  const plastic = new THREE.MeshPhysicalMaterial({ color: 0xdde8ea, roughness: .12, metalness: 0, transparent: true, opacity: .42, clearcoat: 1, clearcoatRoughness: .08, depthWrite: false });
  lathe(profile, plastic, group).renderOrder = 3;
  const fill = .11 + (seed % 3) * .015;
  const liquid = [[0, .003], [.0315, .003], [.0315, fill], [0, fill]];
  lathe(liquid, new THREE.MeshPhysicalMaterial({ color: 0xf2ead6, roughness: .2, transparent: true, opacity: .82, sheen: .4 }), group);
  const cap = part(new THREE.CylinderGeometry(.0145, .0145, .016, 24), new THREE.MeshStandardMaterial({ color: 0xe6ecef, roughness: .45 }), group, 0, .219, 0);
  for (let k = 0; k < 12; k++) { const rib = part(new THREE.BoxGeometry(.002, .014, .002), cap.material as THREE.Material, group); const a = k / 12 * Math.PI * 2; rib.position.set(Math.cos(a) * .0148, .219, Math.sin(a) * .0148); }
  part(new THREE.TorusGeometry(.0135, .0016, 6, 24).rotateX(Math.PI / 2), cap.material as THREE.Material, group, 0, .207, 0);
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128; const c = canvas.getContext('2d')!;
  const g = c.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, '#f4efe2'); g.addColorStop(1, '#e2d6bb'); c.fillStyle = g; c.fillRect(0, 0, 512, 128);
  c.fillStyle = '#6b4a2a'; c.fillRect(0, 0, 512, 14); c.fillRect(0, 114, 512, 14);
  c.fillStyle = '#4b3420'; c.font = '700 34px sans-serif'; c.textAlign = 'center'; c.fillText('МИНДАЛЬНАЯ ВОДА', 256, 60);
  c.font = '500 20px sans-serif'; c.fillText('ALMOND WATER · 0,5 л · ПИТЬ ОХЛАЖДЁННОЙ', 256, 94);
  c.fillStyle = '#c9b48a'; c.beginPath(); c.ellipse(60, 64, 22, 34, .4, 0, 7); c.ellipse(452, 64, 22, 34, -.4, 0, 7); c.fill();
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  part(new THREE.CylinderGeometry(.0345, .0345, .07, 32, 1, true), new THREE.MeshStandardMaterial({ map, roughness: .55 }), group, 0, .095, 0);
  return group;
}
