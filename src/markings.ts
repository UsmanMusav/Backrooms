import * as THREE from 'three';
import { CELL, SPAWN, FUSE_CELLS, PANEL_CELL, EXIT_CELL, findPath, seededRandom } from './level.ts';
import type { Cell } from './level.ts';

/**
 * Traces left on the walls by people who got lost here before: marker arrows trailing toward each
 * fuse (one tick per fuse number), scattered scrawls and one dead-end covered in frantic warnings.
 * Purely presentational and deterministic, so every co-op client sees the same walls.
 */
export type WallFace = { x: number; z: number; dx: number; dz: number };
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const open = (map: boolean[][], x: number, z: number) => map[z]?.[x] === false;

export function wallFaces(map: boolean[][], cell: Cell): WallFace[] {
  return DIRECTIONS.filter(([dx, dz]) => !open(map, cell.x + dx, cell.z + dz)).map(([dx, dz]) => ({ x: cell.x, z: cell.z, dx, dz }));
}

/**
 * The warning wall: a dead end if the map has one, otherwise a corner nook roughly sixteen cells
 * from the spawn (deep enough to be a discovery, on the way to the far fuses). Deterministic.
 */
export function warningCell(map: boolean[][]): WallFace {
  let best: { face: WallFace; score: number } | undefined;
  for (let z = 1; z < map.length - 1; z++) for (let x = 1; x < map.length - 1; x++) {
    if (!open(map, x, z)) continue;
    const faces = wallFaces(map, { x, z });
    if (faces.length < 2) continue;
    const length = findPath(map, SPAWN, { x, z }).length;
    if (length < 10) continue;
    // Prefer a back wall opposite an opening, so the player walks straight at it.
    const face = faces.find(f => open(map, x - f.dx, z - f.dz));
    if (!face) continue;
    const score = (faces.length === 3 ? -100 : 0) + Math.abs(length - 16) + (x + z * 0.01) * 1e-4;
    if (!best || score < best.score) best = { face, score };
  }
  return best!.face;
}

function scrawlCanvas(width: number, height: number) {
  const element = document.createElement('canvas'); element.width = width; element.height = height;
  return { element, ctx: element.getContext('2d')! };
}
/** Hand-drawn line: a polyline with jitter and pressure-varying width. */
function stroke(ctx: CanvasRenderingContext2D, points: [number, number][], width: number, random: () => number) {
  ctx.lineCap = ctx.lineJoin = 'round';
  for (let pass = 0; pass < 2; pass++) {
    ctx.lineWidth = width * (pass ? .55 : 1); ctx.globalAlpha = pass ? .5 : .85;
    ctx.beginPath();
    points.forEach(([x, y], i) => { const jx = (random() - .5) * width * .35, jy = (random() - .5) * width * .35; if (i) ctx.lineTo(x + jx, y + jy); else ctx.moveTo(x + jx, y + jy); });
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
function drips(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, random: () => number, color: string) {
  for (let i = 0; i < 3; i++) {
    if (random() > .55) continue;
    const dx = x + (random() - .5) * width, length = 8 + random() * 40;
    const g = ctx.createLinearGradient(0, y, 0, y + length); g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(dx, y, 2 + random() * 2, length);
  }
}

const INK = ['rgba(92,22,16,1)', 'rgba(34,28,22,1)', 'rgba(70,40,20,1)'];

/** Marker arrow pointing +X with `ticks` short bars underneath (which fuse the trail leads to). */
function arrowTexture(ticks: number, seed: number) {
  const { element, ctx } = scrawlCanvas(256, 128), random = seededRandom(seed);
  const ink = INK[seed % 2]; ctx.strokeStyle = ink;
  const y = 52 + (random() - .5) * 10;
  stroke(ctx, [[22, y + 4], [90, y + 1], [160, y - 2], [205, y]], 16, random);
  stroke(ctx, [[160, y - 36], [212, y], [162, y + 34]], 16, random);
  for (let i = 0; i < ticks; i++) stroke(ctx, [[70 + i * 26, 92], [64 + i * 26, 118]], 8, random);
  drips(ctx, 110, y + 4, 160, random, ink.replace(',1)', ',.6)'));
  const texture = new THREE.CanvasTexture(element); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}

function writeLine(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, angle: number, random: () => number, ink: string) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  ctx.font = `700 ${size}px "Arial Narrow", "Liberation Sans Narrow", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = ink;
  let offset = -ctx.measureText(text).width / 2;
  for (const char of text) {
    // Letter by letter, each slightly off the baseline and rotated, like writing on a wall in a hurry.
    const w = ctx.measureText(char).width;
    ctx.save(); ctx.translate(offset + w / 2, (random() - .5) * size * .12); ctx.rotate((random() - .5) * .12);
    ctx.globalAlpha = .72 + random() * .25; ctx.fillText(char, 0, 0); ctx.restore();
    offset += w * (.92 + random() * .1);
  }
  ctx.restore();
  drips(ctx, x, y + size * .4, ctx.measureText(text).width * .8, random, ink.replace(',1)', ',.55)'));
}

function scrawlTexture(lines: string[], seed: number, width = 512, height = 256) {
  const { element, ctx } = scrawlCanvas(width, height), random = seededRandom(seed), ink = INK[seed % INK.length];
  lines.forEach((line, i) => writeLine(ctx, line, width / 2 + (random() - .5) * 30, height * (i + .75) / (lines.length + .5), Math.min(78, width / Math.max(5, line.length) * 1.25), (random() - .5) * .1, random, ink));
  const texture = new THREE.CanvasTexture(element); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}

/** The dead-end: dozens of overlapping warnings, tally marks and smeared handprints. */
function warningTexture() {
  const { element, ctx } = scrawlCanvas(1024, 896), random = seededRandom(1996);
  const phrases = ['НЕ ДВИГАЙСЯ', 'СТОЙ СМИРНО', 'НЕ ДВИГАЙСЯ', 'ОНО СЛЫШИТ ШАГИ', 'НЕ БЕГИ', 'НЕ ДВИГАЙСЯ', 'ЗАМРИ', 'ОНО ВИДИТ СВЕТ', 'НЕ ВЕРЬ ГОЛОСАМ', 'НЕ ДВИГАЙСЯ', 'СТОЙ', 'ЭТО НЕ ОН', 'ТИХО', 'НЕ ДВИГАЙСЯ'];
  // Rows of scrawl, each written by a different hand; a few are crossed out, one huge line on top.
  writeLine(ctx, 'НЕ ДВИГАЙСЯ', 512, 92, 128, -.03, random, INK[0]);
  let row = 0;
  for (let y = 200; y < 660; y += 66, row++) {
    let x = 70 + random() * 60;
    while (x < 900) {
      const text = phrases[Math.floor(random() * phrases.length)], size = 38 + random() * 26;
      ctx.font = `700 ${size}px "Arial Narrow", sans-serif`;
      const width = ctx.measureText(text).width;
      if (x + width > 990) break;
      const ink = INK[(row + Math.floor(x)) % 3];
      writeLine(ctx, text, x + width / 2, y + (random() - .5) * 18, size, (random() - .5) * .14, random, ink);
      if (random() < .12) { ctx.strokeStyle = ink; stroke(ctx, [[x, y + 4], [x + width, y - 6]], 6, random); }
      x += width + 26 + random() * 50;
    }
  }
  // Tally marks: days counted by someone who stayed.
  ctx.strokeStyle = INK[1];
  for (let g = 0; g < 9; g++) {
    const x0 = 60 + (g % 3) * 70, y0 = 700 + Math.floor(g / 3) * 56;
    for (let i = 0; i < 4; i++) stroke(ctx, [[x0 + i * 11, y0], [x0 + i * 11 + 2, y0 + 40]], 4, random);
    stroke(ctx, [[x0 - 6, y0 + 32], [x0 + 42, y0 + 6]], 4, random);
  }
  // Smeared handprints.
  for (let h = 0; h < 4; h++) {
    const x = 640 + random() * 330, y = 520 + random() * 300; ctx.fillStyle = 'rgba(70,24,14,.55)';
    ctx.beginPath(); ctx.ellipse(x, y, 30, 36, 0, 0, 7); ctx.fill();
    for (let f = 0; f < 5; f++) { const a = -2.4 + f * .42; ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * 48, y + Math.sin(a) * 52, 8, 20, a + Math.PI / 2, 0, 7); ctx.fill(); }
    const g = ctx.createLinearGradient(0, y, 0, y + 120); g.addColorStop(0, 'rgba(70,24,14,.4)'); g.addColorStop(1, 'rgba(70,24,14,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 24, y, 48, 120);
  }
  const texture = new THREE.CanvasTexture(element); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  return texture;
}

const SCRAWLS = [
  ['ВЫХОДА', 'НЕТ'], ['ОН ЗНАЕТ', 'ТВОЁ ИМЯ'], ['НЕ ОТВЕЧАЙ'], ['Я БЫЛ ЗДЕСЬ', '4.07.91'], ['СЧИТАЙ', 'ЛАМПЫ'],
  ['ОНО ПОВТОРЯЕТ', 'ГОЛОСА'], ['НЕ ВЫКЛЮЧАЙ', 'ФОНАРЬ'], ['ДЕНЬ 31'], ['ПРОСНИСЬ'], ['ТУТ БЫЛА', 'ДВЕРЬ'],
];

export type Markings = { group: THREE.Group; warning: THREE.Vector3; dispose(): void };

export function buildWallMarkings(map: boolean[][]): Markings {
  const group = new THREE.Group(); group.name = 'WallMarkings';
  const disposables: { dispose(): void }[] = [];
  const used = new Set<string>();
  const reserved = new Set([`${PANEL_CELL.x},${PANEL_CELL.z}`, `${EXIT_CELL.x},${EXIT_CELL.z}`, '5,4', '6,4']);
  const decal = (face: WallFace, texture: THREE.Texture, width: number, height: number, y: number, mirror = false, along = 0) => {
    const material = new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: .85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const geometry = new THREE.PlaneGeometry(width, height);
    disposables.push(material, geometry, texture);
    const mesh = new THREE.Mesh(geometry, material);
    const yaw = Math.atan2(-face.dx, -face.dz), tangent = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    mesh.rotation.y = yaw; if (mirror) mesh.scale.x = -1;
    mesh.position.set(face.x * CELL + face.dx * (CELL / 2 - .006), y, face.z * CELL + face.dz * (CELL / 2 - .006)).addScaledVector(tangent, along);
    mesh.renderOrder = 2; group.add(mesh);
    used.add(`${face.x},${face.z},${face.dx},${face.dz}`);
    return { mesh, tangent };
  };
  const free = (face: WallFace) => !used.has(`${face.x},${face.z},${face.dx},${face.dz}`) && !reserved.has(`${face.x},${face.z}`);

  // The warning wall, plus spill-over onto its side walls.
  const warning = warningCell(map);
  decal(warning, warningTexture(), CELL * .96, 2.35, 1.35).mesh.name = 'WarningWall';
  for (const side of wallFaces(map, warning).filter(f => f.dx !== warning.dx || f.dz !== warning.dz)) {
    decal(side, scrawlTexture(['НЕ', 'ДВИГАЙСЯ'], 400 + side.dx * 3 + side.dz), 1.4, .7, 1.45 + (side.dx + side.dz) * .12, false, (side.dx + side.dz) * .3).mesh.name = 'WarningSide';
  }

  // Arrow trails from the entrance hall toward each fuse: wherever a wall runs alongside the path, at most every third cell.
  FUSE_CELLS.forEach((fuse, index) => {
    const path = findPath(map, SPAWN, fuse);
    let last = -9;
    for (let i = 1; i < path.length - 1; i++) {
      if (i - last < 3) continue;
      const here = path[i], next = path[i + 1], dx = next.x - here.x, dz = next.z - here.z;
      // Use a wall running parallel to the direction of travel, so the arrow can point along it.
      const face = wallFaces(map, here).find(f => f.dx * dx + f.dz * dz === 0 && free(f));
      if (!face) continue;
      const yaw = Math.atan2(-face.dx, -face.dz), tangent = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const mirror = tangent.x * dx + tangent.z * dz < 0;
      const arrow = decal(face, arrowTexture(index + 1, 31 + index * 7 + i), .86, .43, 1.18 + ((i * 7) % 5) * .06, mirror, ((i * 13) % 5 - 2) * .18);
      arrow.mesh.name = `FuseArrow${index + 1}`; last = i;
    }
  });

  // Scattered scrawls on random free walls away from the entrance.
  const random = seededRandom(4071991);
  let placed = 0, guard = 0;
  while (placed < SCRAWLS.length && guard++ < 600) {
    const x = 2 + Math.floor(random() * (map.length - 4)), z = 2 + Math.floor(random() * (map.length - 4));
    if (!open(map, x, z) || Math.abs(x - SPAWN.x) + Math.abs(z - SPAWN.z) < 4) continue;
    const face = wallFaces(map, { x, z }).filter(free)[0];
    if (!face) continue;
    const lines = SCRAWLS[placed];
    decal(face, scrawlTexture(lines, 90 + placed * 17), 1.15, .58 * Math.max(1, lines.length * .8), 1.25 + random() * .5, false, (random() - .5) * .8).mesh.name = 'Scrawl';
    placed++;
  }
  const warningPosition = new THREE.Vector3(warning.x * CELL, 0, warning.z * CELL);
  return { group, warning: warningPosition, dispose: () => disposables.forEach(item => item.dispose()) };
}
