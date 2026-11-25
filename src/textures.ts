import * as THREE from 'three';
import { seededRandom } from './level';

function canvas(width: number, height: number) {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return { element, ctx: element.getContext('2d', { willReadFrequently: true })! };
}

export function texture(element: HTMLCanvasElement, repeatX = 1, repeatY = 1) {
  const result = new THREE.CanvasTexture(element);
  result.colorSpace = THREE.SRGBColorSpace;
  result.wrapS = result.wrapT = THREE.RepeatWrapping;
  result.repeat.set(repeatX, repeatY);
  result.anisotropy = 8;
  return result;
}

type Ctx = CanvasRenderingContext2D;
/** Soft radial blot; `squash` compensates for non-square texel aspect on wall faces. */
function blot(ctx: Ctx, x: number, y: number, radius: number, rgb: string, alpha: number, squash = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(1, squash);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  gradient.addColorStop(0, `rgba(${rgb},${alpha})`); gradient.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = gradient; ctx.fillRect(-radius, -radius, radius * 2, radius * 2); ctx.restore();
}
/** Closed irregular outline used for tide marks, tears and spills. */
function ragged(ctx: Ctx, x: number, y: number, rx: number, ry: number, random: () => number, points = 22, roughness = .28) {
  ctx.beginPath();
  for (let i = 0; i <= points; i++) {
    const a = i / points * Math.PI * 2, wobble = 1 + (random() - .5) * roughness * 2;
    const px = x + Math.cos(a) * rx * wobble, py = y + Math.sin(a) * ry * wobble;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}
function speckle(ctx: Ctx, random: () => number, count: number, x: number, y: number, w: number, h: number, rgb: string, alpha: number, size = 2) {
  for (let i = 0; i < count; i++) { ctx.fillStyle = `rgba(${rgb},${alpha * random()})`; ctx.fillRect(x + random() * w, y + random() * h, .4 + random() * size, .4 + random() * size); }
}

function wallpaperBase(ctx: Ctx) {
  const random = seededRandom(741);
  ctx.fillStyle = '#b5aa6c';
  ctx.fillRect(0, 0, 512, 1024);
  const pixels = ctx.getImageData(0, 0, 512, 1024);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const noise = (random() - 0.5) * 19;
    pixels.data[i] += noise;
    pixels.data[i + 1] += noise;
    pixels.data[i + 2] += noise;
  }
  ctx.putImageData(pixels, 0, 0);
  damask(ctx, 0, 0, 512, 'rgba(91, 85, 42, 0.19)', 'rgba(231, 219, 153, .25)');
  // Old water damage, grime at the skirting, and paper seams.
  for (let i = 0; i < 80; i++) {
    const x = random() * 512;
    const y = random() * 1024;
    const radius = random() * 110 + 15, alpha = random() * 0.1;
    // Drawn three times so blots crossing an edge continue on the neighbouring panel.
    for (const shift of [-512, 0, 512]) blot(ctx, x + shift, y, radius, '67,57,24', alpha);
  }
  const grime = ctx.createLinearGradient(0, 0, 0, 1024);
  grime.addColorStop(0, 'rgba(32,28,14,.35)');
  grime.addColorStop(0.04, 'rgba(32,28,14,.04)');
  grime.addColorStop(0.65, 'rgba(32,28,14,0)');
  grime.addColorStop(1, 'rgba(30,27,11,.55)');
  ctx.fillStyle = grime;
  ctx.fillRect(0, 0, 512, 1024);
}
// A small, faded damask pattern — not a flat yellow surface.
function damask(ctx: Ctx, offsetY: number, x0: number, x1: number, line: string, fill: string) {
  ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, x1 - x0, 1024); ctx.clip();
  ctx.lineWidth = 1.15;
  for (let y = -48 + offsetY; y < 1100; y += 48) {
    for (let x = -32; x < 548; x += 32) {
      const ox = x + (Math.round((y - offsetY) / 48) % 2) * 16;
      ctx.strokeStyle = line;
      ctx.beginPath();
      ctx.moveTo(ox, y);
      ctx.bezierCurveTo(ox + 2, y + 9, ox + 14, y + 14, ox + 12, y + 24);
      ctx.bezierCurveTo(ox + 14, y + 32, ox + 2, y + 39, ox, y + 48);
      ctx.bezierCurveTo(ox - 2, y + 39, ox - 14, y + 32, ox - 12, y + 24);
      ctx.bezierCurveTo(ox - 14, y + 14, ox - 2, y + 9, ox, y);
      ctx.stroke();
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.ellipse(ox, y + 24, 2, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Number of distinct wallpaper panels. Variant 0 is the clean original. */
export const WALL_VARIANTS = 6;
export const WALL_VARIANT_WEIGHTS = [44, 13, 9, 13, 9, 12] as const;
/**
 * Wall faces are 2.8 m × 2.95 m on a 512 × 1024 canvas, so circles are drawn with a
 * vertical squash of ~1.9. All damage stays clear of the left/right edges, keeping
 * neighbouring panels continuous even when they use different variants.
 */
export function wallpaperTexture(variant = 0) {
  const { element, ctx } = canvas(512, 1024);
  wallpaperBase(ctx);
  const random = seededRandom(9100 + variant * 131), sq = 1.9;
  if (variant === 1) {
    // Tide-marked leak from the ceiling: brown runs with darker drying edges.
    for (let i = 0; i < 9; i++) {
      const x = 120 + random() * 270, w = 5 + random() * 18, length = 160 + random() * 560;
      ctx.beginPath(); ctx.moveTo(x - w, 0);
      for (let y = 0; y <= length; y += 20) ctx.lineTo(x - w * (1 - y / length * .7) + Math.sin(y * .05 + i) * 2.5, y);
      ctx.quadraticCurveTo(x, length + 26, x + w * .3, length);
      for (let y = length; y >= 0; y -= 20) ctx.lineTo(x + w * (1 - y / length * .7) + Math.cos(y * .04 + i) * 2.5, y);
      ctx.closePath();
      const gradient = ctx.createLinearGradient(0, 0, 0, length);
      gradient.addColorStop(0, 'rgba(98,72,26,.38)'); gradient.addColorStop(1, 'rgba(98,72,26,.06)');
      ctx.fillStyle = gradient; ctx.fill(); ctx.strokeStyle = 'rgba(82,56,17,.32)'; ctx.lineWidth = 1.6; ctx.stroke();
    }
    for (let ring = 0; ring < 4; ring++) {
      ragged(ctx, 255, 30, 150 - ring * 28, 150 - ring * 24, random, 30, .12);
      ctx.fillStyle = `rgba(110,82,30,${.07 + ring * .025})`; ctx.fill();
      ctx.strokeStyle = 'rgba(78,54,18,.3)'; ctx.lineWidth = 2; ctx.stroke();
    }
  } else if (variant === 2) {
    // Paper torn off: pale gypsum, glue residue and a curled flap whose back is lighter.
    const cx = 190 + random() * 130, cy = 430 + random() * 220;
    ragged(ctx, cx, cy, 72, 72 * sq, seededRandom(4242), 26, .32);
    ctx.save(); ctx.clip();
    ctx.fillStyle = '#c9c4ab'; ctx.fillRect(0, 0, 512, 1024);
    speckle(ctx, random, 2600, cx - 110, cy - 200, 220, 400, '96,92,72', .45, 2.4);
    for (let i = 0; i < 9; i++) blot(ctx, cx + (random() - .5) * 120, cy + (random() - .5) * 230, 18 + random() * 30, '150,128,72', .35, sq);
    ctx.restore();
    ragged(ctx, cx, cy, 72, 72 * sq, seededRandom(4242), 26, .32);
    ctx.strokeStyle = 'rgba(48,40,18,.55)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = 'rgba(244,236,200,.55)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 48, cy - 110); ctx.quadraticCurveTo(cx + 104, cy - 70, cx + 98, cy + 10); ctx.lineTo(cx + 58, cy - 30); ctx.closePath();
    const flap = ctx.createLinearGradient(cx + 50, cy - 100, cx + 100, cy); flap.addColorStop(0, '#e7dfbd'); flap.addColorStop(1, '#a89a62');
    ctx.fillStyle = flap; ctx.fill(); ctx.strokeStyle = 'rgba(52,44,20,.45)'; ctx.lineWidth = 1.5; ctx.stroke();
    blot(ctx, cx + 88, cy + 4, 34, '30,24,8', .32, sq);
    for (let i = 0; i < 5; i++) { ctx.fillStyle = 'rgba(60,50,24,.35)'; ctx.fillRect(140 + random() * 230, 220 + random() * 600, 1, 18 + random() * 40); }
  } else if (variant === 3) {
    // Damp skirting: mould colonies, a tide line and black scuffs at hip height.
    const tide = 820 + random() * 50;
    ctx.fillStyle = 'rgba(70,64,30,.22)'; ctx.fillRect(40, tide, 432, 1024 - tide);
    ctx.strokeStyle = 'rgba(70,52,20,.35)'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(40, tide);
    for (let x = 40; x <= 472; x += 12) ctx.lineTo(x, tide + Math.sin(x * .07) * 6 + (random() - .5) * 5); ctx.stroke();
    for (let c = 0; c < 9; c++) {
      const x = 70 + random() * 370, y = tide + 20 + random() * (980 - tide);
      for (let i = 0; i < 60; i++) blot(ctx, x + (random() - .5) * 60, y + (random() - .5) * 90, 2 + random() * 9, random() > .5 ? '31,38,22' : '52,48,26', .55, sq);
    }
    for (let i = 0; i < 7; i++) {
      const x = 80 + random() * 330, y = 600 + random() * 160, w = 30 + random() * 60;
      ctx.strokeStyle = `rgba(30,28,22,${.18 + random() * .25})`; ctx.lineWidth = 1 + random() * 2.2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + w / 2, y + (random() - .5) * 8, x + w, y + (random() - .5) * 6); ctx.stroke();
    }
    for (let i = 0; i < 5; i++) blot(ctx, 110 + random() * 300, 470 + random() * 120, 16 + random() * 16, '48,40,24', .14, sq);
  } else if (variant === 4) {
    // Ghost of a removed frame: unfaded rectangle, nail hole and a rust run.
    const x = 150 + random() * 60, y = 250 + random() * 80, w = 170 + random() * 30, h = 260 + random() * 40;
    ctx.fillStyle = 'rgba(214,201,128,.32)'; ctx.fillRect(x, y, w, h);
    damask(ctx, 0, x, x + w, 'rgba(84,76,32,.12)', 'rgba(240,230,170,.12)');
    ctx.strokeStyle = 'rgba(60,52,24,.18)'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
    const nx = x + w / 2, ny = y - 34;
    ctx.fillStyle = '#2b2416'; ctx.beginPath(); ctx.ellipse(nx, ny, 2.6, 4.6, 0, 0, Math.PI * 2); ctx.fill();
    const rust = ctx.createLinearGradient(0, ny, 0, ny + 150); rust.addColorStop(0, 'rgba(118,62,24,.45)'); rust.addColorStop(1, 'rgba(118,62,24,0)');
    ctx.fillStyle = rust; ctx.fillRect(nx - 1.8, ny, 3.6, 150);
    ctx.strokeStyle = 'rgba(52,44,22,.22)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 4, y); ctx.lineTo(nx, ny); ctx.lineTo(x + w - 4, y); ctx.stroke();
  } else if (variant === 5) {
    // Replacement strip from a different print run: shifted pattern, slightly greener paper.
    const strip = ctx.createLinearGradient(128, 0, 384, 0);
    strip.addColorStop(0, 'rgba(176,170,96,0)'); strip.addColorStop(.12, 'rgba(176,170,96,.3)');
    strip.addColorStop(.88, 'rgba(176,170,96,.3)'); strip.addColorStop(1, 'rgba(176,170,96,0)');
    ctx.fillStyle = strip; ctx.fillRect(128, 0, 256, 1024);
    for (let i = 0; i < 7; i++) blot(ctx, 170 + random() * 170, random() * 1024, 30 + random() * 40, '112,96,48', .11, sq);
  }
  return texture(element);
}

function carpetBase(ctx: Ctx) {
  const random = seededRandom(128);
  const pixels = ctx.createImageData(512, 512);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const n = (random() - 0.5) * 36;
    pixels.data[i] = 118 + n;
    pixels.data[i + 1] = 108 + n;
    pixels.data[i + 2] = 70 + n * 0.8;
    pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  for (let i = 0; i < 40000; i++) {
    const x = random() * 512;
    const y = random() * 512;
    ctx.strokeStyle = random() > 0.5 ? 'rgba(36,32,17,.14)' : 'rgba(205,193,129,.15)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (random() - 0.5) * 4, y + 1 + random() * 3);
    ctx.stroke();
  }
  // Interior-only shading so rotated tiles still meet without a visible seam.
  for (let i = 0; i < 12; i++) blot(ctx, 90 + random() * 332, 90 + random() * 332, 25 + random() * 60, '39,33,13', .15);
}

export const CARPET_VARIANTS = 5;
export const CARPET_VARIANT_WEIGHTS = [46, 13, 15, 12, 8] as const;
/** One 2.8 m floor tile. Tiles are rotated/mirrored per cell in addition to these variants. */
export function carpetTexture(variant = 0) {
  const { element, ctx } = canvas(512, 512);
  carpetBase(ctx);
  const random = seededRandom(5300 + variant * 97);
  if (variant === 1) {
    // Soaked patch: darker centre, mineral ring where it dried.
    const x = 200 + random() * 110, y = 200 + random() * 110;
    for (let i = 0; i < 16; i++) blot(ctx, x + (random() - .5) * 120, y + (random() - .5) * 120, 40 + random() * 70, '38,34,14', .22);
    ragged(ctx, x, y, 150, 125, random, 34, .16); ctx.strokeStyle = 'rgba(70,58,26,.32)'; ctx.lineWidth = 4; ctx.stroke();
    ctx.strokeStyle = 'rgba(190,176,120,.12)'; ctx.lineWidth = 2; ctx.stroke();
  } else if (variant === 2) {
    // Crushed, paler pile where people walked; fibres are flattened in one direction.
    ctx.save(); ctx.translate(256, 256); ctx.rotate((random() - .5) * .6);
    const g = ctx.createRadialGradient(0, 0, 10, 0, 0, 220); g.addColorStop(0, 'rgba(190,178,124,.24)'); g.addColorStop(1, 'rgba(190,178,124,0)');
    ctx.scale(1.25, .55); ctx.fillStyle = g; ctx.fillRect(-230, -230, 460, 460); ctx.restore();
    for (let i = 0; i < 2500; i++) { const x = 70 + random() * 372, y = 160 + random() * 190; ctx.fillStyle = 'rgba(206,194,140,.1)'; ctx.fillRect(x, y, 4 + random() * 6, .6); }
  } else if (variant === 3) {
    // Spills, a cigarette burn and grit trodden into the pile.
    for (let s = 0; s < 3; s++) {
      const x = 110 + random() * 290, y = 110 + random() * 290, r = 14 + random() * 30;
      ragged(ctx, x, y, r, r * (.6 + random() * .5), random, 18, .35); ctx.fillStyle = `rgba(${s ? '74,52,24' : '28,24,12'},.35)`; ctx.fill();
      for (let d = 0; d < 7; d++) blot(ctx, x + (random() - .5) * r * 4, y + (random() - .5) * r * 4, 2 + random() * 5, '60,44,20', .4);
    }
    const bx = 150 + random() * 200, by = 150 + random() * 200;
    blot(ctx, bx, by, 9, '14,10,4', .85); blot(ctx, bx, by, 16, '60,40,16', .4);
    speckle(ctx, random, 600, 80, 80, 352, 352, '220,210,170', .5, 1.6); speckle(ctx, random, 500, 80, 80, 352, 352, '20,18,10', .5, 1.4);
  } else if (variant === 4) {
    // A cut-in replacement square from a different dye lot with visible seams.
    const x = 120 + random() * 60, y = 120 + random() * 60, w = 200 + random() * 70, h = 180 + random() * 70;
    ctx.fillStyle = 'rgba(132,128,84,.28)'; ctx.fillRect(x, y, w, h);
    speckle(ctx, random, 3000, x, y, w, h, '40,38,20', .25, 2.2);
    ctx.strokeStyle = 'rgba(36,30,12,.55)'; ctx.lineWidth = 1.6; ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(210,200,150,.2)'; ctx.lineWidth = 1; ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
  }
  return texture(element);
}

export const CEILING_VARIANTS = 4;
export const CEILING_VARIANT_WEIGHTS = [52, 18, 12, 18] as const;
/** One cell of 4 × 4 suspended acoustic tiles; variants stain, replace or remove single tiles. */
export function ceilingTexture(variant = 0) {
  const { element, ctx } = canvas(512, 512);
  const random = seededRandom(918);
  ctx.fillStyle = '#b3b09a';
  ctx.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 512; y += 128) {
    for (let x = 0; x < 512; x += 128) {
      const shade = Math.floor(random() * 17);
      ctx.fillStyle = `rgb(${176 + shade},${173 + shade},${149 + shade})`;
      ctx.fillRect(x + 3, y + 3, 123, 123);
    }
  }
  // Fissured mineral-fibre surface.
  for (let i = 0; i < 22000; i++) {
    ctx.fillStyle = `rgba(40,37,24,${random() * 0.22})`;
    ctx.fillRect(random() * 512, random() * 512, random() * 1.8, random() * 1.2);
  }
  for (let i = 0; i < 900; i++) { ctx.strokeStyle = 'rgba(70,66,48,.18)'; ctx.lineWidth = .8; const x = random() * 512, y = random() * 512; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (random() - .5) * 9, y + (random() - .5) * 9); ctx.stroke(); }
  const vr = seededRandom(6100 + variant * 53), tile = () => ({ x: Math.floor(vr() * 4) * 128, y: Math.floor(vr() * 4) * 128 });
  if (variant === 1) {
    for (let t = 0; t < 2; t++) {
      const { x, y } = tile(), cx = x + 40 + vr() * 48, cy = y + 40 + vr() * 48;
      for (let ring = 0; ring < 5; ring++) {
        ctx.save(); ctx.beginPath(); ctx.rect(x + 3, y + 3, 123, 123); ctx.clip();
        ragged(ctx, cx, cy, 52 - ring * 9, 46 - ring * 8, vr, 24, .15);
        ctx.fillStyle = `rgba(122,92,40,${.05 + ring * .03})`; ctx.fill(); ctx.strokeStyle = 'rgba(96,70,28,.4)'; ctx.lineWidth = 1.6; ctx.stroke(); ctx.restore();
      }
    }
  } else if (variant === 2) {
    // A missing tile reveals the dark plenum and yellow insulation; its neighbour sags.
    const { x, y } = tile();
    ctx.fillStyle = '#16150f'; ctx.fillRect(x + 1, y + 1, 127, 127);
    for (let i = 0; i < 260; i++) { ctx.strokeStyle = `rgba(${150 + vr() * 50},${120 + vr() * 40},50,${.12 + vr() * .2})`; ctx.lineWidth = 1 + vr() * 2; const px = x + 10 + vr() * 108, py = y + 10 + vr() * 108; ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(px + (vr() - .5) * 20, py + (vr() - .5) * 20, px + (vr() - .5) * 26, py + (vr() - .5) * 26); ctx.stroke(); }
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x + 1, y + 1, 127, 10);
    const nx = (x + 128) % 512;
    const sag = ctx.createRadialGradient(nx + 64, y + 64, 6, nx + 64, y + 64, 80); sag.addColorStop(0, 'rgba(40,36,22,.32)'); sag.addColorStop(1, 'rgba(40,36,22,0)');
    ctx.fillStyle = sag; ctx.fillRect(nx + 3, y + 3, 123, 123);
  } else if (variant === 3) {
    // A newer replacement tile and a tile with mould spots.
    const a = tile(); ctx.fillStyle = 'rgba(232,230,212,.55)'; ctx.fillRect(a.x + 3, a.y + 3, 123, 123);
    for (let i = 0; i < 1400; i++) { ctx.fillStyle = `rgba(90,88,76,${vr() * .16})`; ctx.fillRect(a.x + 3 + vr() * 123, a.y + 3 + vr() * 123, 1, 1); }
    const b = tile(); for (let i = 0; i < 80; i++) blot(ctx, b.x + 10 + vr() * 108, b.y + 10 + vr() * 108, 1.5 + vr() * 6, '34,40,24', .5);
  }
  // Exposed tee-grid of the suspended ceiling.
  for (let y = 0; y < 512; y += 128) for (let x = 0; x < 512; x += 128) {
    ctx.strokeStyle = '#6d6b58'; ctx.lineWidth = 1; ctx.strokeRect(x + 1, y + 1, 127, 127);
    ctx.fillStyle = 'rgba(30,28,18,.13)'; ctx.fillRect(x + 3, y + 3, 122, 2); ctx.fillRect(x + 3, y + 3, 2, 122);
  }
  return texture(element);
}

/**
 * World-space, low-frequency tint and dirt on large tiled surfaces. It hides the exact
 * texture period without any extra texture memory or per-cell materials.
 */
export function addMacroVariation(material: THREE.MeshStandardMaterial, strength = .14, scale = .12, seed = 0) {
  material.onBeforeCompile = shader => {
    shader.uniforms.macroStrength = { value: strength };
    shader.uniforms.macroScale = { value: scale };
    shader.uniforms.macroSeed = { value: seed };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMacroWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMacroWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vMacroWorld; uniform float macroStrength; uniform float macroScale; uniform float macroSeed;
float macroHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float macroNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(macroHash(i), macroHash(i + vec2(1.0, 0.0)), u.x), mix(macroHash(i + vec2(0.0, 1.0)), macroHash(i + vec2(1.0, 1.0)), u.x), u.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{ vec2 q = (vMacroWorld.xz + vMacroWorld.y * vec2(0.37, 0.61)) * macroScale + macroSeed;
  float n = macroNoise(q) * 0.62 + macroNoise(q * 2.7 + 5.1) * 0.38;
  float dirt = smoothstep(0.62, 0.9, macroNoise(q * 1.9 + 17.3));
  diffuseColor.rgb *= (1.0 - macroStrength + macroStrength * 1.35 * n) * (1.0 - dirt * macroStrength * 0.9);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.96, 1.0, 0.9), dirt * 0.5); }`);
  };
  material.customProgramCacheKey = () => `macro-${strength}-${scale}-${seed}`;
  return material;
}

export function labelTexture(text: string, foreground = '#e2e2cb', background = '#1a3429', width = 512, height = 160) {
  const { element, ctx } = canvas(width, height);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = foreground;
  ctx.globalAlpha = 0.4;
  ctx.strokeRect(8, 8, width - 16, height - 16);
  ctx.globalAlpha = 1;
  ctx.fillStyle = foreground;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${height * 0.48}px sans-serif`;
  ctx.fillText(text, width / 2, height / 2 + 2, width - 30);
  return texture(element);
}

export function stainTexture() {
  const { element, ctx } = canvas(256, 256);
  const random = seededRandom(19);
  for (let i = 0; i < 90; i++) {
    const x = 128 + (random() - 0.5) * 110;
    const y = 128 + (random() - 0.5) * 110;
    const r = 5 + random() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(26,22,9,.09)');
    g.addColorStop(1, 'rgba(26,22,9,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return texture(element);
}

/** Linear-data normal + roughness maps from the existing deterministic artwork. */
export function surfaceMaps(albedo: THREE.CanvasTexture, depth = 1, rough = .9) {
  const image = albedo.image as HTMLCanvasElement;
  const width = image.width, height = image.height;
  const data = image.getContext('2d')!.getImageData(0, 0, width, height).data;
  const n = canvas(width, height), r = canvas(width, height);
  const normals = n.ctx.createImageData(width, height), roughness = r.ctx.createImageData(width, height);
  const sample = (x: number, y: number) => {
    const i = (((y + height) % height) * width + (x + width) % width) * 4;
    return (data[i] + data[i + 1] + data[i + 2]) / 765;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const dx = (sample(x - 1, y) - sample(x + 1, y)) * depth;
    const dy = (sample(x, y + 1) - sample(x, y - 1)) * depth;
    const length = Math.hypot(dx, dy, 1);
    normals.data[i] = (dx / length * .5 + .5) * 255;
    normals.data[i + 1] = (dy / length * .5 + .5) * 255;
    normals.data[i + 2] = (1 / length * .5 + .5) * 255; normals.data[i + 3] = 255;
    const value = Math.min(255, Math.max(0, (rough + (sample(x, y) - .45) * .1) * 255));
    roughness.data[i] = roughness.data[i + 1] = roughness.data[i + 2] = value; roughness.data[i + 3] = 255;
  }
  n.ctx.putImageData(normals, 0, 0); r.ctx.putImageData(roughness, 0, 0);
  const normalMap = new THREE.CanvasTexture(n.element), roughnessMap = new THREE.CanvasTexture(r.element);
  for (const map of [normalMap, roughnessMap]) { map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.copy(albedo.repeat); map.anisotropy = 8; }
  return { normalMap, roughnessMap };
}

export function cardboardTexture() {
  const { element, ctx } = canvas(256, 256), random = seededRandom(561);
  ctx.fillStyle = '#a5956a'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6000; i++) { ctx.fillStyle = random() > .5 ? 'rgba(44,43,25,.09)' : 'rgba(231,219,172,.11)'; ctx.fillRect(random() * 256, random() * 256, 1, .5 + random() * 3); }
  for (const y of [1, 254]) { ctx.fillStyle = '#6e6b4c'; ctx.fillRect(0, y, 256, 1); }
  return texture(element);
}
