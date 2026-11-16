import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { labelTexture } from './textures';
import { seededRandom } from './level';

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

export function createFuse(index: number) {
  const group = new THREE.Group(); group.name = `CeramicFuse-${index}`;
  const wear = wornMetalTexture();
  const brass = new THREE.MeshStandardMaterial({ color: 0xb4a679, map: wear, metalness: .84, roughness: .3 });
  const porcelain = new THREE.MeshStandardMaterial({ color: 0xe2e1c5, roughness: .27, metalness: .06 });
  const holder = new THREE.MeshStandardMaterial({ color: 0x262e29, roughness: .8 });
  part(rounded(.48, .055, .28, .018), holder, group, 0, -.115);
  const cartridge = new THREE.Group(); group.add(cartridge); cartridge.rotation.z = Math.PI / 2;
  lathe([[0, -.19], [.049, -.19], [.059, -.15], [.053, -.135], [.053, .135], [.059, .15], [.049, .19], [0, .19]], porcelain, cartridge);
  for (const side of [-1, 1]) {
    part(new THREE.CylinderGeometry(.061, .061, .067, 24), brass, cartridge, 0, side * .16);
    part(new THREE.CylinderGeometry(.035, .035, .021, 20), brass, cartridge, 0, side * .205);
    const clip = part(rounded(.042, .085, .12, .006), brass, group, side * .165, -.047);
    clip.rotation.z = side * .12;
  }
  const label = part(new THREE.PlaneGeometry(.15, .045), new THREE.MeshBasicMaterial({ map: labelTexture(`16A  /  0${index + 1}`, '#343d35', '#d8d5b7') }), group, 0, .015, .053);
  label.rotation.x = -.15;
  for (const x of [-.20, .20]) for (const z of [-.095, .095]) part(new THREE.CylinderGeometry(.009, .009, .004, 12), brass, group, x, -.084, z);
  const led = part(new THREE.SphereGeometry(.012, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffba69 }), group, .20, -.075, .08);
  led.name = 'PickupLED';
  const beacon = new THREE.PointLight(0xffba70, .75, 2.2, 1.8); beacon.position.y = .16; group.add(beacon);
  return group;
}

export function createSwitchboard() {
  const group = new THREE.Group(); group.name = 'IndustrialSwitchboard';
  const wear = wornMetalTexture();
  const steel = new THREE.MeshStandardMaterial({ color: 0x6d796c, map: wear, bumpMap: wear, bumpScale: .003, roughness: .56, metalness: .6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151e1a, roughness: .85 });
  const copper = new THREE.MeshStandardMaterial({ color: 0xb09b65, metalness: .7, roughness: .45 });
  part(rounded(.78, .94, .15, .035), steel, group);
  part(rounded(.66, .64, .018, .013), dark, group, 0, -.04, .083);
  const lamps: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * .17;
    part(rounded(.115, .29, .04, .012), steel, group, x, -.03, .105);
    for (const side of [-1, 1]) part(new THREE.CylinderGeometry(.026, .026, .065, 16), copper, group, x, -.03 + side * .095, .14);
    const lamp = part(new THREE.SphereGeometry(.013, 12, 8), new THREE.MeshBasicMaterial({ color: 0x743b28 }), group, x, .19, .117); lamps.push(lamp);
    part(new THREE.PlaneGeometry(.11, .037), new THREE.MeshBasicMaterial({ map: labelTexture(`0${i + 1}`, '#c4c2a0', '#293229') }), group, x, -.26, .096);
  }
  for (const x of [-.32, .32]) for (const y of [-.4, .4]) {
    part(new THREE.CylinderGeometry(.015, .015, .007, 12), copper, group, x, y, .08).rotation.x = Math.PI / 2;
  }
  const indicator = part(new THREE.SphereGeometry(.022, 12, 10), new THREE.MeshBasicMaterial({ color: 0xb95832 }), group, .29, .34, .085);
  const lever = new THREE.Group(); lever.position.set(.31, -.10, .11); group.add(lever);
  part(rounded(.047, .20, .03, .01), dark, lever, 0, -.05, .03);
  part(new THREE.CylinderGeometry(.022, .022, .085, 16), copper, lever, 0, -.13, .06).rotation.z = Math.PI / 2;
  part(new THREE.PlaneGeometry(.39, .07), new THREE.MeshBasicMaterial({ map: labelTexture('⚡  220 V  /  АВАРИЙНОЕ', '#c1b582', '#2b3329') }), group, -.03, .35, .085);
  return { group, indicator, lamps, lever };
}

export function createArchive(index: number) {
  const group = new THREE.Group(); group.name = 'RecoveredFieldNotes';
  const board = new THREE.MeshStandardMaterial({ color: 0x3b4032, roughness: .9 });
  part(rounded(.27, .012, .37, .009), board, group);
  const text = labelTexture(`ЗАПИСЬ 0${index + 1}  /  NOCLIP`, '#454c39', '#c2bea0');
  const paper = part(new THREE.PlaneGeometry(.235, .32), new THREE.MeshStandardMaterial({ map: text, roughness: 1, side: THREE.DoubleSide }), group, 0, .008);
  paper.rotation.x = -Math.PI / 2;
  part(rounded(.085, .008, .025, .004), new THREE.MeshStandardMaterial({ color: 0x88907d, metalness: .8, roughness: .5 }), group, 0, .016, -.16);
  return group;
}

export function disposeProp(group: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  group.traverse(o => { if (o instanceof THREE.Mesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) { materials.add(m); const p = m as THREE.MeshStandardMaterial; for (const t of [p.map, p.bumpMap]) if (t) textures.add(t); } } });
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
