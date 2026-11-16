import * as THREE from 'three';
import { seededRandom } from './level';
import { surfaceMaps, texture } from './textures';

/**
 * Procedural physically based surfaces for world props. Every map is drawn locally from
 * a seed: no downloaded scans, so the bundle remains offline and license-clean.
 */
function canvas(width: number, height = width) {
  const element = document.createElement('canvas'); element.width = width; element.height = height;
  return { element, ctx: element.getContext('2d', { willReadFrequently: true })! };
}
const cache = new Map<string, THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial>();
/** Materials are shared between identical props; disposeProp skips cached ones. */
function cached<T extends THREE.MeshStandardMaterial>(key: string, make: () => T): T {
  let material = cache.get(key) as T | undefined;
  if (!material) { material = make(); material.userData.sharedMaterial = true; cache.set(key, material); }
  return material;
}
function noise(ctx: CanvasRenderingContext2D, size: number, random: () => number, amount: number) {
  const image = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < image.data.length; i += 4) { const n = (random() - .5) * amount; image.data[i] += n; image.data[i + 1] += n; image.data[i + 2] += n; }
  ctx.putImageData(image, 0, 0);
}

/** Enamel-painted sheet steel with orange peel, chipped edges, scratches and rust bloom. */
export function paintedSteel(color: string, seed = 1, rust = .5) {
  return cached(`paint-${color}-${seed}-${rust}`, () => {
    const size = 512, { element, ctx } = canvas(size), random = seededRandom(seed * 37 + 11);
    ctx.fillStyle = color; ctx.fillRect(0, 0, size, size); noise(ctx, size, random, 10);
    for (let i = 0; i < 1600; i++) { ctx.fillStyle = `rgba(255,255,240,${random() * .035})`; ctx.beginPath(); ctx.arc(random() * size, random() * size, 1 + random() * 3, 0, 7); ctx.fill(); }
    for (let i = 0; i < 70; i++) {
      const x = random() * size, y = random() * size, length = 6 + random() * 60, angle = random() * Math.PI;
      ctx.strokeStyle = `rgba(${random() > .4 ? '205,205,190' : '40,38,32'},${.18 + random() * .3})`; ctx.lineWidth = .5 + random();
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length); ctx.stroke();
    }
    // Chips concentrate where hands and doors hit the edges.
    for (let i = 0; i < 90; i++) {
      const edge = random() < .5, x = edge ? (random() < .5 ? random() * 22 : size - random() * 22) : random() * size, y = edge ? random() * size : (random() < .5 ? random() * 22 : size - random() * 22);
      ctx.fillStyle = random() > .5 ? 'rgba(150,150,140,.75)' : 'rgba(70,58,44,.7)';
      ctx.beginPath(); ctx.ellipse(x, y, 1 + random() * 5, 1 + random() * 3, random() * 3, 0, 7); ctx.fill();
    }
    for (let i = 0; i < 26 * rust; i++) {
      const x = random() * size, y = random() * size, r = 4 + random() * 22;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(110,56,22,.55)'); g.addColorStop(.6, 'rgba(126,72,30,.22)'); g.addColorStop(1, 'rgba(126,72,30,0)');
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      const run = ctx.createLinearGradient(0, y, 0, y + r * 5); run.addColorStop(0, 'rgba(110,60,24,.3)'); run.addColorStop(1, 'rgba(110,60,24,0)');
      ctx.fillStyle = run; ctx.fillRect(x - 1.5, y, 3, r * 5);
    }
    const map = texture(element);
    return new THREE.MeshStandardMaterial({ map, ...surfaceMaps(map, 1.4, .58), color: 0xa9a99f, metalness: .3, roughness: .66 });
  });
}

/** Brushed or worn bare metal: brass, steel, zinc and chrome variants. */
export function bareMetal(kind: 'steel' | 'brass' | 'chrome' | 'zinc' | 'copper', seed = 3) {
  return cached(`metal-${kind}-${seed}`, () => {
    const tones = { steel: '#9a9d98', brass: '#b39a5e', chrome: '#c8ccc8', zinc: '#a3a8a2', copper: '#a8704a' } as const;
    const size = 256, { element, ctx } = canvas(size), random = seededRandom(seed * 101 + kind.length);
    ctx.fillStyle = tones[kind]; ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 2600; i++) { ctx.fillStyle = `rgba(${random() > .5 ? '255,255,250' : '20,20,18'},${random() * (kind === 'chrome' ? .05 : .12)})`; ctx.fillRect(random() * size, random() * size, 4 + random() * 40, .4 + random() * .6); }
    if (kind === 'zinc') for (let i = 0; i < 60; i++) { ctx.fillStyle = `rgba(${random() > .5 ? '230,236,232' : '90,96,92'},.18)`; ctx.beginPath(); ctx.moveTo(random() * size, random() * size); for (let k = 0; k < 5; k++) ctx.lineTo(random() * size, random() * size); ctx.fill(); }
    if (kind === 'brass' || kind === 'copper') for (let i = 0; i < 40; i++) { const x = random() * size, y = random() * size, r = 3 + random() * 14; const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(58,68,40,.4)'); g.addColorStop(1, 'rgba(58,68,40,0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
    const map = texture(element);
    const roughness = { steel: .36, brass: .34, chrome: .14, zinc: .42, copper: .38 }[kind];
    return new THREE.MeshStandardMaterial({ map, ...surfaceMaps(map, .7, roughness), metalness: kind === 'zinc' ? .8 : .92, roughness });
  });
}

/** Moulded plastic/bakelite with faint sink marks, dust and handling grime. */
export function moulded(color: string, seed = 5, roughness = .48) {
  return cached(`plastic-${color}-${seed}-${roughness}`, () => {
    const size = 256, { element, ctx } = canvas(size), random = seededRandom(seed * 13 + 7);
    ctx.fillStyle = color; ctx.fillRect(0, 0, size, size); noise(ctx, size, random, 7);
    for (let i = 0; i < 30; i++) { const x = random() * size, y = random() * size, r = 8 + random() * 40; const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(60,54,36,${random() * .12})`); g.addColorStop(1, 'rgba(60,54,36,0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
    for (let i = 0; i < 500; i++) { ctx.fillStyle = `rgba(230,224,200,${random() * .12})`; ctx.fillRect(random() * size, random() * size, 1, 1); }
    const map = texture(element);
    return new THREE.MeshStandardMaterial({ map, ...surfaceMaps(map, .5, roughness), roughness, metalness: 0 });
  });
}

/** Glazed ceramic/porcelain with crazing and a printed rating. */
export function porcelain(seed = 7) {
  return cached(`porcelain-${seed}`, () => {
    const size = 256, { element, ctx } = canvas(size), random = seededRandom(seed);
    ctx.fillStyle = '#e4e1cf'; ctx.fillRect(0, 0, size, size); noise(ctx, size, random, 6);
    ctx.strokeStyle = 'rgba(120,110,80,.16)'; ctx.lineWidth = .6;
    for (let i = 0; i < 90; i++) { let x = random() * size, y = random() * size; ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (random() - .5) * 26; y += (random() - .5) * 26; ctx.lineTo(x, y); } ctx.stroke(); }
    const map = texture(element);
    return new THREE.MeshPhysicalMaterial({ map, ...surfaceMaps(map, .35, .22), roughness: .22, clearcoat: .55, clearcoatRoughness: .2 });
  });
}

/** Woven polyester upholstery with pilling, stains and a darker seat centre. */
export function upholstery(color = '#3c4034', seed = 9) {
  return cached(`fabric-${color}-${seed}`, () => {
    const size = 512, { element, ctx } = canvas(size), random = seededRandom(seed * 29);
    ctx.fillStyle = color; ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 3) for (let x = 0; x < size; x += 3) {
      const over = ((x / 3 + y / 3) & 1) === 0; ctx.fillStyle = over ? 'rgba(255,255,230,.07)' : 'rgba(0,0,0,.12)'; ctx.fillRect(x, y, 3, over ? 2 : 3);
    }
    for (let i = 0; i < 2600; i++) { ctx.fillStyle = `rgba(${random() > .5 ? '200,200,180' : '10,10,6'},${random() * .16})`; ctx.beginPath(); ctx.arc(random() * size, random() * size, .6 + random() * 1.4, 0, 7); ctx.fill(); }
    const g = ctx.createRadialGradient(256, 256, 20, 256, 256, 260); g.addColorStop(0, 'rgba(0,0,0,.18)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 4; i++) { const x = 80 + random() * 350, y = 80 + random() * 350, r = 12 + random() * 40; const s = ctx.createRadialGradient(x, y, 0, x, y, r); s.addColorStop(0, 'rgba(70,56,30,.22)'); s.addColorStop(.85, 'rgba(70,56,30,.12)'); s.addColorStop(1, 'rgba(70,56,30,0)'); ctx.fillStyle = s; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
    const map = texture(element);
    return new THREE.MeshStandardMaterial({ map, ...surfaceMaps(map, 2.6, .97), roughness: .97 });
  });
}

/** Single-wall corrugated board: fibres, faint flute ridges, water marks, print and crushed corners. */
export function cardboard(variant = 0) {
  return cached(`cardboard-${variant}`, () => {
    const size = 512, { element, ctx } = canvas(size), random = seededRandom(561 + variant * 71);
    const tones = ['#a8956a', '#9e8c62', '#b19f74', '#968661'];
    ctx.fillStyle = tones[variant % tones.length]; ctx.fillRect(0, 0, size, size); noise(ctx, size, random, 12);
    for (let x = 0; x < size; x += 7) { ctx.fillStyle = 'rgba(60,48,26,.06)'; ctx.fillRect(x, 0, 2, size); ctx.fillStyle = 'rgba(230,214,170,.05)'; ctx.fillRect(x + 3, 0, 2, size); }
    for (let i = 0; i < 9000; i++) { ctx.fillStyle = random() > .5 ? 'rgba(44,43,25,.1)' : 'rgba(231,219,172,.12)'; ctx.fillRect(random() * size, random() * size, 1, .5 + random() * 4); }
    for (let i = 0; i < 4 + variant; i++) {
      const x = random() * size, y = random() * size, r = 20 + random() * 80;
      ctx.beginPath(); for (let k = 0; k <= 20; k++) { const a = k / 20 * Math.PI * 2, w = 1 + (random() - .5) * .35; ctx.lineTo(x + Math.cos(a) * r * w, y + Math.sin(a) * r * w); }
      ctx.closePath(); ctx.fillStyle = 'rgba(92,72,38,.13)'; ctx.fill(); ctx.strokeStyle = 'rgba(80,60,30,.28)'; ctx.lineWidth = 1.4; ctx.stroke();
    }
    // Flexographic print: "this side up" arrows, glass symbol and lot number.
    ctx.fillStyle = 'rgba(42,40,30,.72)'; ctx.strokeStyle = 'rgba(42,40,30,.72)';
    const px = 340 + random() * 60, py = 70 + random() * 40;
    for (const dx of [0, 34]) { ctx.beginPath(); ctx.moveTo(px + dx, py); ctx.lineTo(px + dx + 13, py + 18); ctx.lineTo(px + dx + 5, py + 18); ctx.lineTo(px + dx + 5, py + 44); ctx.lineTo(px + dx - 5, py + 44); ctx.lineTo(px + dx - 5, py + 18); ctx.lineTo(px + dx - 13, py + 18); ctx.closePath(); ctx.fill(); }
    ctx.lineWidth = 3; ctx.strokeRect(px - 22, py - 10, 78, 64);
    if (variant % 2 === 0) { ctx.beginPath(); ctx.moveTo(px - 10, py + 90); ctx.lineTo(px + 30, py + 90); ctx.lineTo(px + 22, py + 120); ctx.quadraticCurveTo(px + 10, py + 128, px - 2, py + 120); ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(px + 10, py + 126); ctx.lineTo(px + 10, py + 150); ctx.moveTo(px, py + 150); ctx.lineTo(px + 20, py + 150); ctx.stroke(); }
    ctx.font = '600 22px monospace'; ctx.fillText(`ВЕРХ · ${String(19 + variant * 7).padStart(3, '0')}`, 40, 470);
    ctx.font = '500 15px monospace'; ctx.fillText(`ГОСТ 9142  №${4410 + variant * 13}`, 40, 495);
    // Corner crush and edge abrasion.
    for (const [x, y] of [[0, 0], [size, 0], [0, size], [size, size]]) { const g = ctx.createRadialGradient(x, y, 0, x, y, 60); g.addColorStop(0, 'rgba(40,32,18,.3)'); g.addColorStop(1, 'rgba(40,32,18,0)'); ctx.fillStyle = g; ctx.fillRect(x - 60, y - 60, 120, 120); }
    const map = texture(element);
    return new THREE.MeshStandardMaterial({ map, ...surfaceMaps(map, 1.8, .96), color: 0xbdb091, roughness: .96 });
  });
}

/** Shipping label with barcode and handwritten marker. */
export function shippingLabel(seed = 1) {
  const size = 256, { element, ctx } = canvas(size, 160), random = seededRandom(seed * 17);
  ctx.fillStyle = '#d9d6c4'; ctx.fillRect(0, 0, size, 160);
  ctx.fillStyle = '#2a2a24'; ctx.font = '600 15px monospace'; ctx.fillText('NOCLIP LOGISTICS', 12, 22);
  ctx.font = '12px monospace'; ctx.fillText(`СКЛАД 0 · ЯЧ. ${Math.floor(random() * 90 + 10)}-${Math.floor(random() * 9)}`, 12, 40); ctx.fillText('ПОЛУЧАТЕЛЬ: —', 12, 56);
  let x = 12; while (x < 230) { const w = 1 + Math.floor(random() * 3); ctx.fillRect(x, 70, w, 52); x += w + 1 + Math.floor(random() * 3); }
  ctx.font = '11px monospace'; ctx.fillText(`4 607 1${Math.floor(random() * 1e6)}`, 40, 138);
  ctx.strokeStyle = 'rgba(30,40,90,.7)'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(150, 148); ctx.bezierCurveTo(170, 130, 190, 160, 240, 140); ctx.stroke();
  const map = texture(element);
  return new THREE.MeshStandardMaterial({ map, roughness: .85 });
}

/** Ruled paper with handwritten field notes, smudges and a coffee ring. */
export function notePaper(index: number, title: string, lines: string[]) {
  const w = 512, h = 704, { element, ctx } = canvas(w, h), random = seededRandom(800 + index * 41);
  ctx.fillStyle = '#d6d0b6'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 4000; i++) { ctx.fillStyle = `rgba(${random() > .5 ? '120,110,80' : '250,248,236'},${random() * .1})`; ctx.fillRect(random() * w, random() * h, 1, 1); }
  ctx.strokeStyle = 'rgba(70,100,140,.25)'; ctx.lineWidth = 1; for (let y = 120; y < h - 30; y += 30) { ctx.beginPath(); ctx.moveTo(24, y); ctx.lineTo(w - 24, y); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(170,60,60,.3)'; ctx.beginPath(); ctx.moveTo(70, 0); ctx.lineTo(70, h); ctx.stroke();
  ctx.fillStyle = 'rgba(28,34,62,.86)'; ctx.font = 'italic 600 32px Georgia, serif'; ctx.fillText(title, 84, 92);
  ctx.font = 'italic 24px Georgia, serif';
  lines.forEach((line, i) => { ctx.save(); ctx.translate(84 + (random() - .5) * 3, 144 + i * 30); ctx.rotate((random() - .5) * .02); ctx.fillText(line, 0, 0, w - 110); ctx.restore(); });
  ctx.strokeStyle = 'rgba(28,34,62,.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(84, 144 + lines.length * 30 + 8); ctx.lineTo(260, 140 + lines.length * 30 + 12); ctx.stroke();
  const cx = 360 + random() * 80, cy = 520 + random() * 100;
  ctx.strokeStyle = 'rgba(112,72,30,.35)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(cx, cy, 52, .3, 5.9); ctx.stroke(); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx + 3, cy + 2, 46, 0, 6.28); ctx.stroke();
  const edge = ctx.createLinearGradient(0, 0, w, h); edge.addColorStop(0, 'rgba(120,100,60,.15)'); edge.addColorStop(.5, 'rgba(120,100,60,0)'); edge.addColorStop(1, 'rgba(120,100,60,.2)'); ctx.fillStyle = edge; ctx.fillRect(0, 0, w, h);
  const map = texture(element); map.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map, roughness: .92, side: THREE.DoubleSide });
}

/** Debris sheets on the carpet: printed memos, forms and crumpled scraps in one atlas. */
export function debrisPaperAtlas() {
  return cached('debris-paper', () => {
    const w = 1024, h = 512, { element, ctx } = canvas(w, h), random = seededRandom(2718);
    for (let s = 0; s < 4; s++) {
      const x0 = s * 256; ctx.fillStyle = ['#cbc6ac', '#d2cdb8', '#c4bfa0', '#bdb79c'][s]; ctx.fillRect(x0, 0, 256, h);
      ctx.fillStyle = 'rgba(40,40,36,.75)';
      if (s === 0) { ctx.font = '600 22px sans-serif'; ctx.fillText('ПРИКАЗ № 0-117', x0 + 24, 50); ctx.font = '12px sans-serif'; for (let i = 0; i < 24; i++) ctx.fillRect(x0 + 24, 80 + i * 16, 150 + random() * 60, 4); }
      if (s === 1) { ctx.strokeStyle = 'rgba(40,40,36,.6)'; for (let r = 0; r < 12; r++) for (let c = 0; c < 4; c++) ctx.strokeRect(x0 + 20 + c * 54, 60 + r * 32, 54, 32); ctx.font = '600 16px sans-serif'; ctx.fillText('ЖУРНАЛ ОБХОДА', x0 + 24, 40); }
      if (s === 2) { ctx.font = 'italic 20px Georgia, serif'; ctx.fillStyle = 'rgba(28,34,62,.8)'; ['не верь голосу', 'в рации', 'считай', 'шаги'].forEach((t, i) => ctx.fillText(t, x0 + 26, 90 + i * 40)); }
      if (s === 3) { for (let i = 0; i < 30; i++) { ctx.fillRect(x0 + 20, 40 + i * 14, 210 * random(), 3); } }
      for (let i = 0; i < 1600; i++) { ctx.fillStyle = `rgba(80,70,44,${random() * .12})`; ctx.fillRect(x0 + random() * 256, random() * h, 1 + random() * 3, 1); }
      const dirt = ctx.createRadialGradient(x0 + 128 + (random() - .5) * 100, 256 + (random() - .5) * 200, 10, x0 + 128, 256, 260);
      dirt.addColorStop(0, 'rgba(70,58,30,.22)'); dirt.addColorStop(1, 'rgba(70,58,30,0)'); ctx.fillStyle = dirt; ctx.fillRect(x0, 0, 256, h);
      ctx.fillStyle = 'rgba(30,26,14,.25)'; ctx.fillRect(x0 + 254, 0, 2, h);
    }
    const map = texture(element);
    return new THREE.MeshStandardMaterial({ map, roughness: .95, side: THREE.DoubleSide });
  });
}

/** Grey hardboard (masonite) clipboard surface. */
export function hardboard() {
  return cached('hardboard', () => {
    const size = 256, { element, ctx } = canvas(size), random = seededRandom(404);
    ctx.fillStyle = '#5b4a33'; ctx.fillRect(0, 0, size, size); noise(ctx, size, random, 16);
    for (let i = 0; i < 1600; i++) { ctx.fillStyle = `rgba(${random() > .5 ? '120,98,66' : '30,22,12'},.15)`; ctx.fillRect(random() * size, random() * size, 6 + random() * 20, .6); }
    const map = texture(element);
    return new THREE.MeshStandardMaterial({ map, ...surfaceMaps(map, .9, .7), roughness: .7 });
  });
}

/** Prismatic acrylic lens of a troffer with the two hot tube bands behind it. */
export function prismaticLens(horizontal: boolean) {
  const w = horizontal ? 512 : 128, h = horizontal ? 128 : 512, { element, ctx } = canvas(w, h);
  ctx.fillStyle = '#c9cbb4'; ctx.fillRect(0, 0, w, h);
  for (const offset of [.3, .7]) {
    const g = horizontal ? ctx.createLinearGradient(0, h * offset - 22, 0, h * offset + 22) : ctx.createLinearGradient(w * offset - 22, 0, w * offset + 22, 0);
    g.addColorStop(0, 'rgba(255,255,236,0)'); g.addColorStop(.5, 'rgba(255,255,240,1)'); g.addColorStop(1, 'rgba(255,255,236,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) { ctx.fillStyle = (x + y) % 8 ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.08)'; ctx.fillRect(x, y, 2, 2); }
  const random = seededRandom(w + h); for (let i = 0; i < 14; i++) { ctx.fillStyle = 'rgba(40,36,20,.22)'; ctx.beginPath(); ctx.arc(random() * w, random() * h, 2 + random() * 6, 0, 7); ctx.fill(); }
  const edge = ctx.createLinearGradient(0, 0, horizontal ? 0 : w, horizontal ? h : 0); edge.addColorStop(0, 'rgba(60,56,36,.3)'); edge.addColorStop(.12, 'rgba(60,56,36,0)'); edge.addColorStop(.88, 'rgba(60,56,36,0)'); edge.addColorStop(1, 'rgba(60,56,36,.3)');
  ctx.fillStyle = edge; ctx.fillRect(0, 0, w, h);
  return texture(element);
}

/** Wired safety glass for fire doors. */
export function wiredGlass() {
  return cached('wired-glass', () => {
    const size = 256, { element, ctx } = canvas(size);
    ctx.fillStyle = '#4e5a50'; ctx.fillRect(0, 0, size, size);
    const g = ctx.createLinearGradient(0, 0, size, size); g.addColorStop(0, 'rgba(220,230,210,.18)'); g.addColorStop(.45, 'rgba(220,230,210,0)'); g.addColorStop(.6, 'rgba(220,230,210,.1)'); g.addColorStop(1, 'rgba(220,230,210,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(190,196,182,.55)'; ctx.lineWidth = 1.2;
    for (let i = -size; i < size * 2; i += 24) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + size, size); ctx.stroke(); ctx.beginPath(); ctx.moveTo(i, size); ctx.lineTo(i + size, 0); ctx.stroke(); }
    const map = texture(element); map.repeat.set(1, 2);
    return new THREE.MeshPhysicalMaterial({ map, roughness: .08, metalness: .1, clearcoat: 1, clearcoatRoughness: .05, transparent: true, opacity: .82 });
  });
}

/** Back-lit emergency exit sign face with running-man pictogram. */
export function exitSignTexture() {
  const w = 512, h = 160, { element, ctx } = canvas(w, h);
  ctx.fillStyle = '#1f8a4c'; ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 1.6); glow.addColorStop(0, 'rgba(255,255,255,.18)'); glow.addColorStop(1, 'rgba(0,0,0,.2)'); ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#eef8ee'; ctx.strokeStyle = '#eef8ee'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // Door outline and running figure (ISO 7010 style, drawn from primitives).
  ctx.lineWidth = 7; ctx.strokeRect(36, 24, 62, 112); ctx.fillStyle = '#1f8a4c'; ctx.fillRect(58, 20, 44, 120); ctx.fillStyle = '#eef8ee';
  ctx.beginPath(); ctx.arc(120, 38, 11, 0, 7); ctx.fill(); ctx.lineWidth = 11;
  ctx.beginPath(); ctx.moveTo(112, 56); ctx.lineTo(100, 90); ctx.lineTo(118, 108); ctx.lineTo(108, 136); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(100, 90); ctx.lineTo(80, 112); ctx.lineTo(62, 112); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(108, 62); ctx.lineTo(132, 76); ctx.lineTo(146, 64); ctx.stroke(); ctx.beginPath(); ctx.moveTo(108, 62); ctx.lineTo(88, 72); ctx.lineTo(80, 88); ctx.stroke();
  ctx.font = '700 64px sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText('ВЫХОД', 182, 84);
  ctx.beginPath(); ctx.moveTo(430, 84); ctx.lineTo(482, 84); ctx.lineWidth = 10; ctx.stroke(); ctx.beginPath(); ctx.moveTo(462, 62); ctx.lineTo(486, 84); ctx.lineTo(462, 106); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, w - 6, h - 6);
  return texture(element);
}

/** Printed electrical warning sticker. */
export function warningSticker() {
  const w = 256, h = 128, { element, ctx } = canvas(w, h);
  ctx.fillStyle = '#d8c23a'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#16140e'; ctx.beginPath(); ctx.moveTo(56, 14); ctx.lineTo(104, 110); ctx.lineTo(8, 110); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#d8c23a'; ctx.beginPath(); ctx.moveTo(56, 32); ctx.lineTo(90, 100); ctx.lineTo(22, 100); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#16140e'; ctx.beginPath(); ctx.moveTo(62, 44); ctx.lineTo(46, 74); ctx.lineTo(58, 74); ctx.lineTo(48, 98); ctx.lineTo(68, 66); ctx.lineTo(56, 66); ctx.closePath(); ctx.fill();
  ctx.font = '700 19px sans-serif'; ctx.fillText('ОПАСНО', 118, 50); ctx.font = '600 14px sans-serif'; ctx.fillText('220 / 380 В', 118, 74); ctx.fillText('АВАРИЙНОЕ', 118, 96);
  const random = seededRandom(66); for (let i = 0; i < 400; i++) { ctx.fillStyle = `rgba(60,50,20,${random() * .2})`; ctx.fillRect(random() * w, random() * h, 2, 1); }
  return new THREE.MeshStandardMaterial({ map: texture(element), roughness: .6 });
}

/** Releases per-prop materials while keeping cached shared ones alive. */
export function isSharedMaterial(material: THREE.Material) { return material.userData.sharedMaterial === true; }
