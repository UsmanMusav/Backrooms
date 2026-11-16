import * as THREE from 'three';
import { seededRandom } from './level';

function canvas(width: number, height: number) {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return { element, ctx: element.getContext('2d')! };
}

function texture(element: HTMLCanvasElement, repeatX = 1, repeatY = 1) {
  const result = new THREE.CanvasTexture(element);
  result.colorSpace = THREE.SRGBColorSpace;
  result.wrapS = result.wrapT = THREE.RepeatWrapping;
  result.repeat.set(repeatX, repeatY);
  result.anisotropy = 8;
  return result;
}

export function wallpaperTexture() {
  const { element, ctx } = canvas(512, 1024);
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
  // A small, faded damask pattern — not a flat yellow surface.
  ctx.lineWidth = 1.15;
  for (let y = -48; y < 1100; y += 48) {
    for (let x = -24; x < 540; x += 32) {
      const ox = x + (Math.round(y / 48) % 2) * 16;
      ctx.strokeStyle = 'rgba(91, 85, 42, 0.19)';
      ctx.beginPath();
      ctx.moveTo(ox, y);
      ctx.bezierCurveTo(ox + 2, y + 9, ox + 14, y + 14, ox + 12, y + 24);
      ctx.bezierCurveTo(ox + 14, y + 32, ox + 2, y + 39, ox, y + 48);
      ctx.bezierCurveTo(ox - 2, y + 39, ox - 14, y + 32, ox - 12, y + 24);
      ctx.bezierCurveTo(ox - 14, y + 14, ox - 2, y + 9, ox, y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(231, 219, 153, .25)';
      ctx.beginPath();
      ctx.ellipse(ox, y + 24, 2, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Old water damage, grime at the skirting, and paper seams.
  for (let i = 0; i < 80; i++) {
    const x = random() * 512;
    const y = random() * 1024;
    const radius = random() * 110 + 15;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(67,57,24,${random() * 0.1})`);
    gradient.addColorStop(1, 'rgba(67,57,24,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  const grime = ctx.createLinearGradient(0, 0, 0, 1024);
  grime.addColorStop(0, 'rgba(32,28,14,.35)');
  grime.addColorStop(0.04, 'rgba(32,28,14,.04)');
  grime.addColorStop(0.65, 'rgba(32,28,14,0)');
  grime.addColorStop(1, 'rgba(30,27,11,.55)');
  ctx.fillStyle = grime;
  ctx.fillRect(0, 0, 512, 1024);
  for (const x of [0, 256, 511]) {
    ctx.fillStyle = 'rgba(44,40,18,.16)';
    ctx.fillRect(x, 0, 1, 1024);
    ctx.fillStyle = 'rgba(235,219,152,.12)';
    ctx.fillRect(x + 1, 0, 1, 1024);
  }
  return texture(element);
}

export function carpetTexture() {
  const { element, ctx } = canvas(512, 512);
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
  for (let i = 0; i < 12; i++) {
    const x = random() * 512;
    const y = random() * 512;
    const radius = 25 + random() * 90;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, 'rgba(39,33,13,.15)');
    gradient.addColorStop(1, 'rgba(39,33,13,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  return texture(element, 27, 27);
}

export function ceilingTexture() {
  const { element, ctx } = canvas(512, 512);
  const random = seededRandom(918);
  ctx.fillStyle = '#b3b09a';
  ctx.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 512; y += 128) {
    for (let x = 0; x < 512; x += 128) {
      const shade = Math.floor(random() * 17);
      ctx.fillStyle = `rgb(${176 + shade},${173 + shade},${149 + shade})`;
      ctx.fillRect(x + 3, y + 3, 123, 123);
      ctx.strokeStyle = '#6d6b58';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1, y + 1, 127, 127);
      ctx.fillStyle = 'rgba(30,28,18,.13)';
      ctx.fillRect(x + 3, y + 3, 122, 2);
      ctx.fillRect(x + 3, y + 3, 2, 122);
    }
  }
  for (let i = 0; i < 22000; i++) {
    ctx.fillStyle = `rgba(40,37,24,${random() * 0.22})`;
    ctx.fillRect(random() * 512, random() * 512, random() * 1.8, random() * 1.2);
  }
  return texture(element, 27, 27);
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
