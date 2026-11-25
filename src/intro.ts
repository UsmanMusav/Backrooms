import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { CastMember } from './avatar';
import type { Soundscape } from './audio';
import { seededRandom } from './level';

/**
 * Found-footage prologue in the spirit of analogue "lost tape" horror: friends shooting an amateur
 * film on a sunny suburban street, the camera operator backs up for a wide shot, catches the kerb
 * and slips out of reality. Everything is drawn and voiced from local, bundled assets.
 */
export type IntroPhase = 'card' | 'play' | 'take' | 'backup' | 'fall' | 'void' | 'wake' | 'done';
export type IntroFrame = {
  phase: IntroPhase;
  /** Seconds since the current phase began. */
  t: number;
  subtitle: { speaker: string; text: string } | null;
  prompt: string | null;
  glitch: number;
  blackout: number;
  /** 0..1 progress of waking up on Level 0 carpet. */
  wake: number;
  stamp: string;
  clock: string;
  scramble: boolean;
};

const DIRECTOR = 'АРТЁМ', ACTRESS = 'ЛЕНА';
export const INTRO_LINES = {
  d1: { speaker: DIRECTOR, text: 'Так… мотор. Ползи медленнее. Медленнее… Вот так.' },
  d2: { speaker: DIRECTOR, text: 'Стоп! Снято! Отлично получилось!' },
  a1: { speaker: ACTRESS, text: 'Я в этой маске вообще ничего не вижу!' },
  a2: { speaker: ACTRESS, text: 'Ну что, получилось? Можно уже снять её? Тут жарко, как в печке.' },
  d3: { speaker: DIRECTOR, text: 'Слушай, давай теперь общий план. Отойди назад.' },
  d4: { speaker: DIRECTOR, text: 'Ещё… ещё немного назад.' },
  d5: { speaker: DIRECTOR, text: 'Ещё чуть-чуть… Стой, осторожно, там бордюр!' },
  d6: { speaker: DIRECTOR, text: 'Эй?.. Ты где? Это не смешно!' },
  a3: { speaker: ACTRESS, text: 'Куда он делся?!' },
} as const;
type LineId = keyof typeof INTRO_LINES;

export const INTRO_TIMING = { card: 4.6, play: 1.4, fall: 2.3, void: 1.7, wake: 7 } as const;
/** Distance to the kerb behind the operator, metres. */
export const KERB_DISTANCE = 2.3;
const CAMERA_START = new THREE.Vector3(.25, 1.53, 1.05);
const FRIEND_POS = new THREE.Vector3(.6, .1, -8.2);

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const yawToward = (fromX: number, fromZ: number, toX: number, toZ: number) => Math.atan2(-(toX - fromX), -(toZ - fromZ));

// ---- Procedural street surfaces ---------------------------------------------------------------

function canvas(width: number, height = width) {
  const element = document.createElement('canvas'); element.width = width; element.height = height;
  return { element, ctx: element.getContext('2d')! };
}
function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, random: () => number, count: number, light: string, dark: string, size = 2) {
  for (let i = 0; i < count; i++) { ctx.fillStyle = random() > .5 ? light : dark; ctx.fillRect(random() * w, random() * h, random() * size + .5, random() * size + .5); }
}
function tex(element: HTMLCanvasElement, rx = 1, ry = 1, srgb = true) {
  const t = new THREE.CanvasTexture(element); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 8; return t;
}
function asphalt() {
  const { element, ctx } = canvas(512), random = seededRandom(1991);
  ctx.fillStyle = '#3e3d3a'; ctx.fillRect(0, 0, 512, 512);
  speckle(ctx, 512, 512, random, 26000, 'rgba(150,146,135,.35)', 'rgba(15,15,14,.4)', 2.2);
  for (let i = 0; i < 10; i++) {
    // Tar-sealed crack lines and darker patch repairs.
    ctx.strokeStyle = 'rgba(18,18,17,.75)'; ctx.lineWidth = 1 + random() * 2.5; ctx.beginPath();
    let x = random() * 512, y = random() * 512; ctx.moveTo(x, y);
    for (let k = 0; k < 9; k++) { x += (random() - .5) * 60; y += (random() - .3) * 40; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  for (let i = 0; i < 3; i++) { ctx.fillStyle = 'rgba(24,24,23,.45)'; ctx.fillRect(random() * 400, random() * 400, 60 + random() * 90, 40 + random() * 70); }
  for (let i = 0; i < 40; i++) { const x = random() * 512, y = random() * 512, r = 10 + random() * 50; const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(${random() > .5 ? '90,86,78' : '25,25,24'},.18)`); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
  return tex(element, 24, 1.4);
}
function concrete(joints: number) {
  const { element, ctx } = canvas(512), random = seededRandom(77 + joints);
  ctx.fillStyle = '#a7a397'; ctx.fillRect(0, 0, 512, 512);
  speckle(ctx, 512, 512, random, 18000, 'rgba(215,212,200,.3)', 'rgba(70,68,60,.22)', 1.6);
  for (let i = 0; i < 26; i++) { const x = random() * 512, y = random() * 512, r = 20 + random() * 70; const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(80,76,62,.16)'); g.addColorStop(1, 'rgba(80,76,62,0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
  ctx.strokeStyle = 'rgba(55,52,45,.8)'; ctx.lineWidth = 3;
  for (let i = 0; i <= joints; i++) { ctx.beginPath(); ctx.moveTo(i * 512 / joints, 0); ctx.lineTo(i * 512 / joints, 512); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(40,38,32,.55)'; ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) { ctx.beginPath(); let x = random() * 512, y = random() * 512; ctx.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (random() - .5) * 50; y += (random() - .5) * 50; ctx.lineTo(x, y); } ctx.stroke(); }
  return tex(element);
}
function grass() {
  const { element, ctx } = canvas(512), random = seededRandom(406);
  ctx.fillStyle = '#56692f'; ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 30; i++) { const x = random() * 512, y = random() * 512, r = 30 + random() * 110; const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, random() > .6 ? 'rgba(150,140,70,.35)' : 'rgba(35,60,22,.35)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
  for (let i = 0; i < 52000; i++) {
    const x = random() * 512, y = random() * 512, l = 2 + random() * 5, tone = random();
    ctx.strokeStyle = tone > .7 ? 'rgba(160,170,90,.5)' : tone > .35 ? 'rgba(70,98,38,.55)' : 'rgba(30,48,18,.5)';
    ctx.lineWidth = .7; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (random() - .5) * 2, y - l); ctx.stroke();
  }
  return tex(element, 80, 17);
}
function siding(color: string) {
  const { element, ctx } = canvas(256), random = seededRandom(color.length * 31 + color.charCodeAt(2));
  ctx.fillStyle = color; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 16; i++) {
    const y = i * 16, g = ctx.createLinearGradient(0, y, 0, y + 16);
    g.addColorStop(0, 'rgba(0,0,0,.28)'); g.addColorStop(.12, 'rgba(0,0,0,.05)'); g.addColorStop(.9, 'rgba(255,255,255,.08)'); g.addColorStop(1, 'rgba(255,255,255,.12)');
    ctx.fillStyle = g; ctx.fillRect(0, y, 256, 16);
  }
  speckle(ctx, 256, 256, random, 2500, 'rgba(255,255,250,.08)', 'rgba(40,36,30,.08)', 1.5);
  for (let i = 0; i < 18; i++) { ctx.fillStyle = 'rgba(70,60,40,.06)'; ctx.fillRect(random() * 256, 0, 2 + random() * 8, 256); }
  return tex(element, 3, 1.4);
}
function shingles() {
  const { element, ctx } = canvas(256), random = seededRandom(5150);
  ctx.fillStyle = '#4a4744'; ctx.fillRect(0, 0, 256, 256);
  for (let row = 0; row < 16; row++) for (let col = 0; col < 9; col++) {
    const x = col * 32 - (row % 2) * 16, y = row * 16, v = 52 + random() * 34;
    ctx.fillStyle = `rgb(${v + 4},${v},${v - 4})`; ctx.fillRect(x + 1, y + 1, 30, 14);
    ctx.fillStyle = 'rgba(10,10,10,.55)'; ctx.fillRect(x, y + 13, 32, 3);
  }
  speckle(ctx, 256, 256, random, 6000, 'rgba(160,150,135,.18)', 'rgba(0,0,0,.25)', 1.2);
  return tex(element, 5, 3);
}
function garageDoor() {
  const { element, ctx } = canvas(256), random = seededRandom(31);
  ctx.fillStyle = '#ddd8c8'; ctx.fillRect(0, 0, 256, 256);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    const x = 8 + c * 61, y = 8 + r * 62;
    ctx.fillStyle = 'rgba(0,0,0,.14)'; ctx.fillRect(x, y, 55, 52); ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.fillRect(x + 3, y + 3, 49, 46); ctx.fillStyle = '#d4cfbe'; ctx.fillRect(x + 4, y + 4, 47, 44);
  }
  for (let r = 1; r < 4; r++) { ctx.fillStyle = 'rgba(30,28,24,.5)'; ctx.fillRect(0, r * 62 + 3, 256, 2); }
  speckle(ctx, 256, 256, random, 1500, 'rgba(255,255,255,.1)', 'rgba(60,50,30,.1)', 1.4);
  const g = ctx.createLinearGradient(0, 200, 0, 256); g.addColorStop(0, 'rgba(70,60,40,0)'); g.addColorStop(1, 'rgba(70,60,40,.35)'); ctx.fillStyle = g; ctx.fillRect(0, 200, 256, 56);
  return tex(element);
}
function bark() {
  const { element, ctx } = canvas(128, 256), random = seededRandom(88);
  ctx.fillStyle = '#4d4236'; ctx.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 260; i++) { ctx.strokeStyle = random() > .5 ? 'rgba(25,20,15,.6)' : 'rgba(120,108,90,.35)'; ctx.lineWidth = 1 + random() * 2; const x = random() * 128, y = random() * 256; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (random() - .5) * 6, y + 10 + random() * 40); ctx.stroke(); }
  return tex(element, 2, 3);
}
function paperBag() {
  const { element, ctx } = canvas(512, 256), random = seededRandom(1313);
  ctx.fillStyle = '#a88a5c'; ctx.fillRect(0, 0, 512, 256);
  speckle(ctx, 512, 256, random, 9000, 'rgba(210,180,130,.18)', 'rgba(70,52,30,.16)', 2);
  for (let i = 0; i < 40; i++) { ctx.strokeStyle = `rgba(60,44,26,${.1 + random() * .2})`; ctx.lineWidth = .7; ctx.beginPath(); const x = random() * 512, y = random() * 256; ctx.moveTo(x, y); ctx.lineTo(x + (random() - .5) * 120, y + (random() - .5) * 60); ctx.stroke(); }
  // The face, in thick marker on the front quarter of the wrap.
  ctx.save(); ctx.translate(64, 0);
  ctx.fillStyle = '#0d0b08'; ctx.beginPath(); ctx.ellipse(-26, 112, 16, 21, -.2, 0, 7); ctx.ellipse(28, 108, 15, 23, .25, 0, 7); ctx.fill();
  ctx.strokeStyle = '#17120c'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-46, 82); ctx.lineTo(-10, 92); ctx.moveTo(48, 80); ctx.lineTo(12, 90); ctx.stroke();
  ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-34, 176); for (let i = 0; i <= 8; i++) ctx.lineTo(-34 + i * 9, 176 + (i % 2 ? 12 : 0)); ctx.stroke();
  ctx.restore();
  return tex(element);
}

/** Small porch flag for the Fourth of July (13 stripes, star field as dots). */
function porchFlag() {
  const { element, ctx } = canvas(256, 136);
  for (let i = 0; i < 13; i++) { ctx.fillStyle = i % 2 ? '#efe9dc' : '#a8262c'; ctx.fillRect(0, i * 136 / 13, 256, 136 / 13 + .5); }
  ctx.fillStyle = '#2b3466'; ctx.fillRect(0, 0, 104, 73);
  ctx.fillStyle = '#efe9dc';
  for (let r = 0; r < 9; r++) for (let c = 0; c < (r % 2 ? 5 : 6); c++) { ctx.beginPath(); ctx.arc(9 + c * 17 + (r % 2) * 8.5, 5 + r * 7.6, 2, 0, 7); ctx.fill(); }
  const t = tex(element); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}

function leafNoise() {
  const { element, ctx } = canvas(256), random = seededRandom(912);
  ctx.fillStyle = '#d8d8d8'; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4200; i++) { const v = 120 + random() * 135; ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.beginPath(); ctx.ellipse(random() * 256, random() * 256, 1.5 + random() * 3, 1 + random() * 2, random() * 3, 0, 7); ctx.fill(); }
  return tex(element, 3, 3);
}

// ---- Geometry helpers -------------------------------------------------------------------------

function box(w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y, z); return g;
}
function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, shadows = true) {
  const m = new THREE.Mesh(geometry, material); m.castShadow = shadows; m.receiveShadow = true; return m;
}
/** Smoothly lumpy crown of foliage: displaced icosphere with per-vertex leaf tone variation. */
function crown(radius: number, random: () => number) {
  const source = new THREE.IcosahedronGeometry(radius, 4); source.deleteAttribute('normal'); source.deleteAttribute('uv');
  const g = mergeVertices(source), p = g.attributes.position, colors: number[] = []; source.dispose();
  const seeds = Array.from({ length: 6 }, () => new THREE.Vector3(random() - .5, random() - .5, random() - .5).normalize());
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); const n = v.clone().normalize();
    let bump = 0; for (const s of seeds) bump += Math.pow(Math.max(0, n.dot(s)), 3) * .35;
    // Leaf clumps: layered high-frequency lumps so the silhouette breaks up like foliage.
    const jitter = (Math.sin(v.x * 9.1 + v.y * 3.1) * Math.cos(v.z * 7.7) + Math.sin(v.y * 11.3 + v.x * 5.3)) * .05 + Math.sin(v.x * 23.0) * Math.sin(v.y * 19.0) * Math.sin(v.z * 21.0) * .07;
    v.multiplyScalar(1 + bump + jitter); v.y *= .82; p.setXYZ(i, v.x, v.y, v.z);
    const tone = .5 + bump * .8 + n.y * .3 + (random() - .5) * .35, dry = Math.max(0, n.y) * .25;
    colors.push((.19 + dry * .2) * tone, (.31 + dry * .1) * tone, .1 * tone);
  }
  const uvs: number[] = [];
  for (let i = 0; i < p.count; i++) uvs.push(Math.atan2(p.getZ(i), p.getX(i)) / Math.PI * 2, p.getY(i) * 1.4);
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals(); return g;
}

export class FoundFootageIntro {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(56, 16 / 9, .05, 420);
  phase: IntroPhase = 'card';
  private t = 0;
  private total = 0;
  private audio: Soundscape;
  private buffers = new Map<LineId, AudioBuffer | undefined>();
  private cast: { director: CastMember; actress: CastMember; friend: CastMember };
  private disposables: { dispose(): void }[] = [];
  private envTarget?: THREE.WebGLRenderTarget;
  private cueIndex = 0;
  private nextCueAt = 0;
  private subtitle: { speaker: string; text: string; until: number } | null = null;
  private creeping = false;
  private cut = false;
  private directorWalk = 0;
  private back = 0;
  private stepDistance = 0;
  private promptAt = 0;
  private said = new Set<LineId>();
  private lookYaw = 0;
  private lookPitch = 0;
  private backHeld = false;
  private touch: boolean;
  private actressPos = new THREE.Vector3(-2.1, .1, -6.75);
  /** 0..1: how far the friend's startled reaction has played (the creature reached him). */
  private scared = 0;
  private directorArrived = false;
  private directorTalk = 0;
  private aim = new THREE.Vector3();
  private aimVelocity = new THREE.Vector3();
  private fov = 40;
  private jolt = new THREE.Vector3();
  private joltTimer = 2.5;
  private random = seededRandom(704);
  private directorPos = new THREE.Vector3(4.8, 0, -1.6);

  constructor(renderer: THREE.WebGLRenderer, audio: Soundscape, touch = false, shadowSize = 2048) {
    this.audio = audio; this.touch = touch;
    for (const id of Object.keys(INTRO_LINES) as LineId[]) void audio.loadClip(`/audio/intro/${id}.mp3`).then(buffer => this.buffers.set(id, buffer));
    this.scene.name = 'FoundFootageStreet';
    this.buildSky(renderer);
    this.buildStreet();
    this.buildHouses();
    this.buildTrees();
    this.buildPoles();
    this.buildCar();
    this.bakeStatic();
    this.cast = this.buildCast();
    this.aim.copy(this.subject());
    this.scene.traverse(o => { if (o instanceof THREE.DirectionalLight) o.shadow.mapSize.set(shadowSize, shadowSize); });
    this.camera.position.copy(CAMERA_START); this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); this.camera.lookAt(this.aim);
  }

  // ---- World -----------------------------------------------------------------------------------

  private track<T extends { dispose(): void }>(item: T) { this.disposables.push(item); return item; }

  private buildSky(renderer: THREE.WebGLRenderer) {
    // Golden hour on the Fourth of July: low warm sun behind the operator's left shoulder, long shadows.
    const horizon = new THREE.Color(0xf2c994), sunDirection = new THREE.Vector3(-.66, .2, .72).normalize();
    const sky = new THREE.Mesh(this.track(new THREE.SphereGeometry(400, 32, 16)), this.track(new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { sun: { value: sunDirection }, horizon: { value: horizon }, zenith: { value: new THREE.Color(0x4a77b8) } },
      vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 sun; uniform vec3 horizon; uniform vec3 zenith; varying vec3 vDir;
        void main() {
          float h = max(vDir.y, 0.0);
          vec3 c = mix(horizon, zenith, pow(h, 0.42));
          float s = max(dot(normalize(vDir), sun), 0.0);
          c += vec3(1.0, 0.7, 0.4) * (pow(s, 5.0) * 0.5 + pow(s, 300.0) * 2.5);
          c = mix(c, vec3(0.98, 0.62, 0.42), smoothstep(0.25, 0.0, h) * 0.35);
          c = mix(c, horizon * 0.85, smoothstep(0.0, -0.2, vDir.y));
          gl_FragColor = vec4(c, 1.0);
        }`,
    })));
    sky.name = 'EveningSky'; this.scene.add(sky);
    this.scene.fog = new THREE.Fog(horizon, 45, 260);
    // Image-based light from the sky dome so glass, chrome and paint have something to reflect.
    const pmrem = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene(); envScene.add(sky.clone());
    const ground = new THREE.Mesh(new THREE.CircleGeometry(300, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4f5435 })); ground.position.y = -1; envScene.add(ground);
    this.envTarget = pmrem.fromScene(envScene, .02); this.scene.environment = this.envTarget.texture;
    (this.scene as THREE.Scene & { environmentIntensity?: number }).environmentIntensity = .55;
    ground.geometry.dispose(); (ground.material as THREE.Material).dispose(); pmrem.dispose();
    const hemi = new THREE.HemisphereLight(0xc9d4ea, 0x6d5838, .9); this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffbe7a, 4.9);
    sun.position.copy(sunDirection).multiplyScalar(40).add(new THREE.Vector3(0, 0, -4)); sun.target.position.set(0, 0, -4);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera; s.left = s.bottom = -32; s.right = s.top = 32; s.near = 1; s.far = 130;
    sun.shadow.bias = -.0004; sun.shadow.normalBias = .03;
    this.scene.add(sun, sun.target);
  }

  private buildStreet() {
    const roadMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(asphalt()), roughness: .93 }));
    const road = mesh(this.track(new THREE.PlaneGeometry(240, 7).rotateX(-Math.PI / 2)), roadMat, false); road.name = 'Asphalt'; this.scene.add(road);
    const lineMat = this.track(new THREE.MeshStandardMaterial({ color: 0xd9d4bc, roughness: .8 }));
    const dashes: THREE.BufferGeometry[] = [];
    for (let x = -120; x < 120; x += 9) dashes.push(new THREE.PlaneGeometry(3, .12).rotateX(-Math.PI / 2).translate(x, .004, 0));
    const lines = mesh(this.track(mergeGeometries(dashes)), lineMat, false); this.scene.add(lines); dashes.forEach(d => d.dispose());
    const kerbTex = this.track(concrete(6)); kerbTex.repeat.set(40, .25);
    const walkTex = this.track(concrete(4)); walkTex.repeat.set(40, 1);
    const kerbMat = this.track(new THREE.MeshStandardMaterial({ map: kerbTex, roughness: .9, color: 0xd6d3c8 }));
    const walkMat = this.track(new THREE.MeshStandardMaterial({ map: walkTex, roughness: .92 }));
    const lawnMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(grass()), roughness: 1 }));
    for (const side of [-1, 1]) {
      const kerb = mesh(this.track(box(240, .14, .16, 0, .07, side * 3.58)), kerbMat); kerb.name = side > 0 ? 'KerbBehindCamera' : 'Kerb'; this.scene.add(kerb);
      this.scene.add(mesh(this.track(box(240, .12, 1.6, 0, .06, side * 4.46)), walkMat));
      const lawn = mesh(this.track(new THREE.PlaneGeometry(240, 50).rotateX(-Math.PI / 2).translate(0, .1, side * 30.26)), lawnMat, false); this.scene.add(lawn);
    }
    // Driveways cross the sidewalk to each garage.
    const drive = this.track(concrete(3)); drive.repeat.set(1, 4);
    const driveMat = this.track(new THREE.MeshStandardMaterial({ map: drive, roughness: .9 }));
    for (const [x, side] of [[-17.5, -1], [-1.5, -1], [14.5, -1], [30.5, -1], [-9.5, 1], [6.5, 1], [22.5, 1]] as const)
      this.scene.add(mesh(this.track(box(3.4, .02, 7.2, x, .11, side * 8.9)), driveMat, false));
    // A low white picket fence the "victim" leans on.
    const pickets: THREE.BufferGeometry[] = [];
    for (let x = -5.5; x <= 4.6; x += .16) {
      const picket = new THREE.BoxGeometry(.08, .92, .025); const p = picket.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getY(i) > .4) p.setY(i, .46 + (Math.abs(p.getX(i)) < .01 ? .06 : 0) - Math.abs(p.getX(i)) * .9);
      picket.translate(x, .56, -8.75); pickets.push(picket);
    }
    pickets.push(box(10.2, .07, .04, -.45, .4, -8.72), box(10.2, .07, .04, -.45, .8, -8.72));
    for (let x = -5.5; x <= 4.7; x += 2.5) pickets.push(box(.1, 1.05, .1, x, .55, -8.75));
    const paint = this.track(new THREE.MeshStandardMaterial({ color: 0xe9e6da, roughness: .7 }));
    const fence = mesh(this.track(mergeGeometries(pickets)), paint); fence.name = 'PicketFence'; this.scene.add(fence); pickets.forEach(g => g.dispose());
    // Mailbox on a post by the kerb.
    const post = mesh(this.track(box(.09, 1.05, .09, 5.6, .6, -5.5)), this.track(new THREE.MeshStandardMaterial({ color: 0x5b4733, roughness: .9 })));
    const mail = mesh(this.track(new THREE.CylinderGeometry(.12, .12, .46, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).translate(5.6, 1.16, -5.5)), this.track(new THREE.MeshStandardMaterial({ color: 0x2f3c4e, roughness: .4, metalness: .6 })));
    const base = mesh(this.track(box(.24, .14, .46, 5.6, 1.12, -5.5)), this.track(new THREE.MeshStandardMaterial({ color: 0x2f3c4e, roughness: .4, metalness: .6 })));
    this.scene.add(post, mail, base);
  }

  private buildHouses() {
    const palette = ['#c9bf9f', '#a9b7b4', '#d8d0bd', '#b9a383', '#c4c7b2', '#cdb9a0', '#9eaab0'];
    const roofMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(shingles()), roughness: .95 }));
    const trimMat = this.track(new THREE.MeshStandardMaterial({ color: 0xf0ede2, roughness: .6 }));
    const glassMat = this.track(new THREE.MeshStandardMaterial({ color: 0x1c252c, roughness: .06, metalness: .85, envMapIntensity: 1.4 }));
    const doorMat = this.track(new THREE.MeshStandardMaterial({ color: 0x6a3c28, roughness: .55 }));
    const shutterMat = this.track(new THREE.MeshStandardMaterial({ color: 0x324335, roughness: .65 }));
    const garageMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(garageDoor()), roughness: .6 }));
    const brickMat = this.track(new THREE.MeshStandardMaterial({ color: 0x7a4535, roughness: .95 }));
    const flagMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(porchFlag()), roughness: .85, side: THREE.DoubleSide }));
    const houses: [number, number][] = [[-20, -1], [-4, -1], [12, -1], [28, -1], [-12, 1], [4, 1], [20, 1]];
    houses.forEach(([x, side], index) => {
      const group = new THREE.Group(); group.name = 'House'; group.position.set(x, .1, side * 17); group.rotation.y = side < 0 ? 0 : Math.PI;
      const W = 10, D = 8, H = 2.9, R = 1.7, o = .45;
      const wallMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(siding(palette[index % palette.length])), roughness: .8 }));
      group.add(mesh(this.track(box(W, H, D, 0, H / 2, 0)), wallMat));
      // Gable roof: two pitched slabs with eaves overhang, and siding-clad gable triangles.
      const half = D / 2 + o, angle = Math.atan2(R, D / 2), length = half / Math.cos(angle);
      for (const s of [-1, 1]) {
        const slab = new THREE.BoxGeometry(W + o * 2, .14, length); slab.rotateX(s * angle); slab.translate(0, H + R / 2 - o * Math.tan(angle) / 2 + .05, s * half / 2);
        group.add(mesh(this.track(slab), roofMat));
        const gable = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-D / 2, 0), new THREE.Vector2(D / 2, 0), new THREE.Vector2(0, R)]));
        gable.rotateY(s * Math.PI / 2); gable.translate(s * W / 2 * 1.0005, H, 0); group.add(mesh(this.track(gable), wallMat));
        group.add(mesh(this.track(box(W + o * 2, .16, .05, 0, H - .02, s * (D / 2 + o))), trimMat));
      }
      group.add(mesh(this.track(box(.85, 1.5, .85, W * .28, H + R * .8, -1)), brickMat));
      // Front façade (+Z locally): windows with frames, mullions and shutters, door, garage.
      const front = D / 2;
      const windows = index % 2 ? [-3.3, -1.2] : [-3.6, -1.6];
      for (const wx of windows) {
        group.add(mesh(this.track(box(1.34, 1.24, .1, wx, 1.55, front + .02)), trimMat));
        group.add(mesh(this.track(box(1.16, 1.06, .06, wx, 1.55, front + .05)), glassMat));
        group.add(mesh(this.track(mergeGeometries([box(.05, 1.06, .04, wx, 1.55, front + .09), box(1.16, .05, .04, wx, 1.55, front + .09)])), trimMat));
        group.add(mesh(this.track(box(1.5, .07, .2, wx, .94, front + .08)), trimMat));
        for (const s of [-1, 1]) group.add(mesh(this.track(box(.4, 1.26, .05, wx + s * .9, 1.55, front + .04)), shutterMat));
      }
      group.add(mesh(this.track(box(1.12, 2.2, .12, .55, 1.1, front + .02)), trimMat));
      group.add(mesh(this.track(box(.96, 2.08, .08, .55, 1.04, front + .06)), doorMat));
      group.add(mesh(this.track(new THREE.SphereGeometry(.035, 8, 6).translate(.88, 1.02, front + .12)), this.track(new THREE.MeshStandardMaterial({ color: 0xc0a060, metalness: 1, roughness: .3 }))));
      group.add(mesh(this.track(box(1.8, .16, 1.0, .55, .08, front + .5)), this.track(new THREE.MeshStandardMaterial({ color: 0x9a978c, roughness: .9 }))));
      group.add(mesh(this.track(box(3.1, 2.3, .1, 2.8, 1.15, front + .02)), trimMat));
      group.add(mesh(this.track(box(2.9, 2.15, .08, 2.8, 1.08, front + .06)), garageMat));
      if (index % 3 !== 1) {
        // Bracket-mounted porch flag beside the door, pole angled out over the lawn.
        const flag = new THREE.Group(); flag.name = 'Flag'; flag.position.set(-.25, 2.05, front + .06); flag.rotation.x = .55;
        flag.add(mesh(this.track(new THREE.CylinderGeometry(.018, .018, 1.7, 6).translate(0, .85, 0)), trimMat));
        const cloth = new THREE.PlaneGeometry(.95, .5, 8, 2); const cp = cloth.attributes.position;
        for (let i = 0; i < cp.count; i++) cp.setZ(i, Math.sin((cp.getX(i) + .5) * 5.5) * .04 * (cp.getX(i) + .48));
        cloth.computeVertexNormals(); cloth.translate(.5, 1.42, 0); cloth.rotateY(index % 2 ? .4 : -.3);
        flag.add(mesh(this.track(cloth), flagMat)); group.add(flag);
      }
      this.scene.add(group);
    });
  }

  private buildTrees() {
    const random = seededRandom(7041);
    const barkMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(bark()), roughness: .95 }));
    const leafMat = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .8, map: this.track(leafNoise()) }));
    const spots: [number, number, number][] = [[-9, -10.5, 1.1], [7.5, -11, 1.25], [19, -9.5, .9], [-26, -10, 1.15], [-14, 9.5, 1.05], [11, 9.8, 1.2], [30, 10, 1], [-3, 24, 1.4], [24, -26, 1.5]];
    for (const [x, z, scale] of spots) {
      const tree = new THREE.Group(); tree.name = 'Tree'; tree.position.set(x, .1, z); tree.scale.setScalar(scale);
      const trunk = new THREE.CylinderGeometry(.13, .22, 3.4, 10, 4); const p = trunk.attributes.position;
      for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + Math.sin(p.getY(i) * 1.3) * .06);
      trunk.translate(0, 1.7, 0); tree.add(mesh(this.track(trunk), barkMat));
      for (let i = 0; i < 4; i++) {
        const c = mesh(this.track(crown(1.15 + random() * .5, random)), leafMat);
        c.position.set((random() - .5) * 1.4, 3.6 + random() * 1.2, (random() - .5) * 1.4); tree.add(c);
      }
      this.scene.add(tree);
    }
  }

  private buildPoles() {
    const wood = this.track(new THREE.MeshStandardMaterial({ map: this.track(bark()), color: 0x8a7a66, roughness: .95 }));
    const ceramic = this.track(new THREE.MeshStandardMaterial({ color: 0x6e8a80, roughness: .3 }));
    const wireMat = this.track(new THREE.MeshStandardMaterial({ color: 0x1a1a18, roughness: .6 }));
    const poles = [-34, -4, 26], z = 6.1, top = 8.6, arms = [-1, 0, 1];
    for (const x of poles) {
      const pole = mesh(this.track(new THREE.CylinderGeometry(.12, .17, top + .4, 10).translate(x, (top + .4) / 2, z)), wood); pole.name = 'UtilityPole'; this.scene.add(pole);
      this.scene.add(mesh(this.track(box(2.4, .12, .12, x, top - .4, z)), wood));
      this.scene.add(mesh(this.track(mergeGeometries(arms.map(a => new THREE.CylinderGeometry(.04, .05, .16, 8).translate(x + a * 1.05, top - .26, z)))), ceramic));
      // Pole-mounted transformer can on the middle pole.
      if (x === -4) this.scene.add(mesh(this.track(new THREE.CylinderGeometry(.32, .32, .9, 16).translate(x, top - 1.5, z - .3)), this.track(new THREE.MeshStandardMaterial({ color: 0x7c8580, roughness: .5, metalness: .6 }))));
    }
    for (let i = 0; i < poles.length - 1; i++) for (const a of arms) {
      const start = new THREE.Vector3(poles[i] + a * 1.05, top - .2, z), end = new THREE.Vector3(poles[i + 1] + a * 1.05, top - .2, z);
      const points = Array.from({ length: 24 }, (_, k) => { const t = k / 23; return start.clone().lerp(end, t).add(new THREE.Vector3(0, -Math.sin(t * Math.PI) * .9, 0)); });
      this.scene.add(mesh(this.track(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 40, .013, 5)), wireMat, false));
    }
  }

  private buildCar() {
    const car = new THREE.Group(); car.name = 'ParkedSedan'; car.position.set(-6.8, 0, -2.25);
    const paint = this.track(new THREE.MeshPhysicalMaterial({ color: 0x6b2b28, roughness: .38, metalness: .25, clearcoat: .7, clearcoatRoughness: .2 }));
    const glass = this.track(new THREE.MeshPhysicalMaterial({ color: 0x1b2126, roughness: .05, metalness: .3, envMapIntensity: 1.6 }));
    const chrome = this.track(new THREE.MeshStandardMaterial({ color: 0xd0d2cf, roughness: .15, metalness: 1 }));
    const rubber = this.track(new THREE.MeshStandardMaterial({ color: 0x161615, roughness: .85 }));
    const extrude = (points: [number, number][], depth: number, bevel = .04) => {
      const g = new THREE.ExtrudeGeometry(new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y))), { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 4 });
      g.translate(0, 0, -depth / 2); return g;
    };
    car.add(mesh(this.track(extrude([[-2.32, .34], [2.3, .34], [2.36, .6], [2.24, .8], [1.0, .88], [-1.55, .9], [-2.3, .86], [-2.36, .6]], 1.64)), paint));
    car.add(mesh(this.track(extrude([[1.0, .9], [.42, 1.36], [-1.02, 1.37], [-1.56, .92]], 1.44, .03)), glass));
    car.add(mesh(this.track(box(1.5, .05, 1.5, -.3, 1.4, 0)), paint));
    // Pillars over the glasshouse so it reads as framed windows, not a dark block.
    for (const s of [-1, 1]) {
      const a = box(.07, .64, .06, .72, 1.12, s * .74); a.rotateZ(0); car.add(mesh(this.track(a), paint));
      car.add(mesh(this.track(box(.09, .5, .06, -.3, 1.14, s * .755)), paint));
      car.add(mesh(this.track(box(.08, .55, .06, -1.3, 1.14, s * .75)), paint));
      car.add(mesh(this.track(box(4.3, .05, .02, 0, .6, s * .87)), chrome));
    }
    for (const x of [-2.42, 2.42]) car.add(mesh(this.track(box(.12, .17, 1.8, x, .44, 0)), chrome));
    car.add(mesh(this.track(box(.04, .2, .9, 2.38, .64, 0)), this.track(new THREE.MeshStandardMaterial({ color: 0x1c1c1a, roughness: .5, metalness: .4 }))));
    const lamp = this.track(new THREE.MeshStandardMaterial({ color: 0xe8e6d8, emissive: 0x2a2820, roughness: .1 }));
    const tail = this.track(new THREE.MeshStandardMaterial({ color: 0x8e1610, emissive: 0x200402, roughness: .2 }));
    for (const s of [-1, 1]) { car.add(mesh(this.track(box(.04, .16, .3, 2.39, .64, s * .62)), lamp)); car.add(mesh(this.track(box(.04, .14, .36, -2.37, .66, s * .6)), tail)); }
    car.add(mesh(this.track(box(.02, .14, .4, -2.4, .5, 0)), this.track(new THREE.MeshStandardMaterial({ color: 0xe8e4d4, roughness: .5 }))));
    for (const [x, z] of [[1.45, .78], [1.45, -.78], [-1.45, .78], [-1.45, -.78]]) {
      car.add(mesh(this.track(new THREE.CylinderGeometry(.33, .33, .22, 24).rotateX(Math.PI / 2).translate(x, .33, z)), rubber));
      car.add(mesh(this.track(new THREE.CylinderGeometry(.2, .2, .02, 24).rotateX(Math.PI / 2).translate(x, .33, z + Math.sign(z) * .115)), chrome));
    }
    // Contact shadow under the chassis.
    const shadow = new THREE.Mesh(this.track(new THREE.PlaneGeometry(4.6, 1.9).rotateX(-Math.PI / 2).translate(0, .006, 0)), this.track(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .45, depthWrite: false })));
    car.add(shadow);
    this.scene.add(car);
  }

  /**
   * Collapse the hundreds of static street parts into one draw call per material/shadow mode, so
   * the sunny exterior (with shadow pass) stays as cheap as the Backrooms level on weak GPUs.
   */
  private bakeStatic() {
    this.scene.updateMatrixWorld(true);
    const groups = new Map<string, { material: THREE.Material; cast: boolean; geometries: THREE.BufferGeometry[]; names: Set<string> }>();
    const remove: THREE.Mesh[] = [];
    this.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh || Array.isArray(object.material)) return;
      const material = object.material as THREE.Material;
      if (material instanceof THREE.ShaderMaterial || material.transparent) return;
      const key = `${material.uuid}-${object.castShadow}`;
      let group = groups.get(key);
      if (!group) groups.set(key, group = { material, cast: object.castShadow, geometries: [], names: new Set() });
      const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
      group.geometries.push(geometry);
      // Keep identifiable names (House, Tree, ...) as lightweight markers for tests and debugging.
      let named: THREE.Object3D | null = object; while (named && !named.name) named = named.parent;
      if (named && named !== this.scene) group.names.add(named.name);
      remove.push(object);
    });
    for (const object of remove) object.removeFromParent();
    const markers = new Map<string, number>();
    for (const group of groups.values()) {
      const indexed = group.geometries.every(g => g.index);
      const list = group.geometries.map(g => { const out = indexed ? g : g.index ? g.toNonIndexed() : g; for (const name of Object.keys(out.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) out.deleteAttribute(name); return out; });
      const merged = mergeGeometries(list);
      list.forEach(g => g.dispose()); group.geometries.forEach(g => g.dispose());
      if (!merged) continue;
      const baked = mesh(this.track(merged), group.material, group.cast); baked.name = 'StaticStreet'; this.scene.add(baked);
      for (const name of group.names) markers.set(name, (markers.get(name) ?? 0) + 1);
    }
    // Empty groups that held the original parts become name-only markers.
    const empties: THREE.Object3D[] = [];
    this.scene.traverse(o => { if (o !== this.scene && o.type === 'Group' && o.children.length === 0) empties.push(o); });
    for (const empty of empties) { const marker = new THREE.Object3D(); marker.name = empty.name; marker.position.copy(empty.position); empty.removeFromParent(); this.scene.add(marker); }
    for (const [name] of markers) if (!this.scene.getObjectByName(name)) { const marker = new THREE.Object3D(); marker.name = name; this.scene.add(marker); }
  }

  private buildCast() {
    const director = new CastMember('director', 'Director');
    const actress = new CastMember('actress', 'MaskedActress');
    const friend = new CastMember('friend', 'Friend');
    const bagTexture = this.track(paperBag());
    const bagGeometry = new THREE.CylinderGeometry(.155, .17, .4, 18, 4, true); const p = bagGeometry.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) * (1 + Math.sin(i * 1.7) * .035)); p.setZ(i, p.getZ(i) * (.92 + Math.cos(i * 2.3) * .03)); if (y > .19) p.setY(i, y + Math.sin(i) * .015); }
    bagGeometry.rotateY(-Math.PI / 2); bagGeometry.computeVertexNormals();
    const bag = new THREE.Mesh(this.track(bagGeometry), this.track(new THREE.MeshStandardMaterial({ map: bagTexture, roughness: .95, side: THREE.DoubleSide })));
    bag.name = 'PaperBagMask'; bag.castShadow = true;
    const top = new THREE.Mesh(this.track(new THREE.CircleGeometry(.158, 18).rotateX(-Math.PI / 2).translate(0, .19, 0)), bag.material); bag.add(top);
    actress.wear(bag, 0, 1.63, .015);
    director.group.position.copy(this.directorPos); director.group.rotation.y = yawToward(this.directorPos.x, this.directorPos.z, -1, -1.2);
    actress.group.position.copy(this.actressPos); actress.group.position.y = .1;
    actress.group.rotation.y = yawToward(this.actressPos.x, this.actressPos.z, FRIEND_POS.x, FRIEND_POS.z);
    // The "victim" leans on the fence, gazing down the street, oblivious to the creature.
    friend.group.position.copy(FRIEND_POS); friend.group.rotation.y = yawToward(FRIEND_POS.x, FRIEND_POS.z, 9, -4);
    for (const member of [director, actress, friend]) this.scene.add(member.group);
    actress.play('crouch', 0); friend.play('idle', 0, .8);
    return { director, actress, friend };
  }

  // ---- Timeline --------------------------------------------------------------------------------

  private say(id: LineId, gain = 1, pan = 0) {
    this.said.add(id);
    const line = INTRO_LINES[id];
    const duration = this.audio.playClip(this.buffers.get(id), gain, pan) || line.text.length * .06 + .5;
    this.subtitle = { speaker: line.speaker, text: line.text, until: this.total + duration + .35 };
    return duration;
  }
  private enter(phase: IntroPhase) { this.phase = phase; this.t = 0; }

  /** Shot list. A cue waits for its gap and, if given, for `ready` (with a safety timeout). */
  private readonly script: { gap: number; line?: LineId; ready?: () => boolean; action?: () => void }[] = [
    { gap: .9, line: 'd1', action: () => { this.creeping = true; } },
    { gap: .4, line: 'd2', ready: () => this.scared > .9, action: () => { this.cut = true; this.creeping = false; } },
    { gap: .25, line: 'a1', action: () => { this.directorWalk = 1; } },
    { gap: .45, line: 'a2' },
    { gap: .3, line: 'd3', ready: () => this.directorArrived, action: () => { this.cast.director.play('interact', .25); this.directorTalk = 1.6; } },
    { gap: .5, action: () => { this.enter('backup'); this.promptAt = 0; } },
  ];

  setBackInput(held: boolean) { this.backHeld = held; }
  look(dx: number, dy: number) {
    if (this.phase !== 'take' && this.phase !== 'backup') return;
    this.lookYaw = Math.max(-.55, Math.min(.55, this.lookYaw - dx * .0016));
    this.lookPitch = Math.max(-.3, Math.min(.3, this.lookPitch - dy * .0016));
  }
  /** Jump straight into the Backrooms. */
  skip() { if (this.phase === 'done') return; this.audio.stopIntro(.25); this.enter('done'); }
  resize(aspect: number) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

  update(dt: number): IntroFrame {
    this.t += dt; this.total += dt;
    let glitch = 0, blackout = 0, prompt: string | null = null, wake = 0;
    if (this.phase === 'card') {
      blackout = 1;
      if (this.t >= INTRO_TIMING.card) { this.enter('play'); this.audio.startOutdoor(); }
    } else if (this.phase === 'play') {
      glitch = 1 - smooth(.5, INTRO_TIMING.play, this.t);
      blackout = 1 - smooth(.25, .7, this.t);
      if (this.t >= INTRO_TIMING.play) { this.enter('take'); this.nextCueAt = this.script[0].gap; }
    } else if (this.phase === 'take') {
      while (this.phase === 'take' && this.cueIndex < this.script.length && this.t >= this.nextCueAt) {
        const pending = this.script[this.cueIndex];
        if (pending.ready && !pending.ready() && this.t < this.nextCueAt + 7) break;
        const cue = this.script[this.cueIndex++];
        const duration = cue.line ? this.say(cue.line, cue.line.startsWith('a') ? .95 : 1, cue.line.startsWith('a') ? -.25 : .2) : 0;
        cue.action?.();
        const next = this.script[this.cueIndex];
        if (next) this.nextCueAt = this.t + duration + next.gap;
      }
    } else if (this.phase === 'backup') {
      this.promptAt += dt;
      const auto = this.promptAt > 6;
      const speed = this.backHeld ? .85 : auto ? .5 : 0;
      this.back = Math.min(KERB_DISTANCE, this.back + speed * dt);
      this.stepDistance += speed * dt;
      if (this.stepDistance > .5) { this.stepDistance = 0; this.audio.streetStep(); }
      if (this.back > .7 && !this.said.has('d4')) this.say('d4', 1, .2);
      if (this.back > 1.5 && !this.said.has('d5')) this.say('d5', 1, .2);
      if (!this.backHeld && this.back < .2) prompt = this.touch ? 'Удерживайте «НАЗАД»' : 'Удерживайте S — отойти назад';
      if (this.back >= KERB_DISTANCE) { this.enter('fall'); this.audio.noclip(); }
    } else if (this.phase === 'fall') {
      glitch = .25 + smooth(.1, 1.2, this.t) * .75;
      blackout = smooth(1.25, 1.8, this.t);
      if (this.t > .55 && !this.said.has('d6')) this.say('d6', .9, .3);
      if (this.t > 1.25 && !this.said.has('a3')) this.say('a3', .7, -.4);
      if (this.t >= INTRO_TIMING.fall) { this.enter('void'); this.audio.landing(); }
    } else if (this.phase === 'void') {
      blackout = 1; glitch = .2;
      if (this.t >= INTRO_TIMING.void) { this.enter('wake'); this.audio.stopIntro(1.2); }
    } else if (this.phase === 'wake') {
      wake = Math.min(1, this.t / INTRO_TIMING.wake);
      blackout = 1 - smooth(.3, 1.8, this.t);
      glitch = .55 * (1 - smooth(0, 2.4, this.t)) + (this.t > 2.6 && this.t < 2.85 ? .35 : 0);
      if (this.t >= INTRO_TIMING.wake) this.enter('done');
    }
    if (this.phase !== 'card' && this.phase !== 'void' && this.phase !== 'wake' && this.phase !== 'done') {
      this.audio.outdoorTick(dt);
      this.animateCast(dt);
      this.animateCamera(dt);
    }
    if (this.subtitle && this.total > this.subtitle.until) this.subtitle = null;
    const footage = Math.max(0, this.total - INTRO_TIMING.card);
    const clockSeconds = 18 * 3600 + 47 * 60 + 12 + Math.floor(footage);
    const clock = `PM ${Math.floor(clockSeconds / 3600) % 12 || 12}:${String(Math.floor(clockSeconds / 60) % 60).padStart(2, '0')}:${String(clockSeconds % 60).padStart(2, '0')}`;
    const inside = this.phase === 'wake' || this.phase === 'done';
    return {
      phase: this.phase, t: this.t, prompt, glitch, blackout, wake,
      subtitle: this.subtitle && { speaker: this.subtitle.speaker, text: this.subtitle.text },
      stamp: inside ? 'НОЯ.16 1998' : 'ИЮЛ. 4 1991', clock: inside ? 'AM 3:14:00' : clock,
      scramble: this.phase === 'fall' && this.t > .8 || this.phase === 'void' || (this.phase === 'wake' && this.t < 2.4),
    };
  }

  private turn(member: CastMember, x: number, z: number, rate: number, dt: number) {
    const from = member.group.position, face = yawToward(from.x, from.z, x, z), r = member.group.rotation;
    r.y += Math.atan2(Math.sin(face - r.y), Math.cos(face - r.y)) * Math.min(1, dt * rate);
  }

  private animateCast(dt: number) {
    const { director, actress, friend } = this.cast;
    const cam = this.camera.position;
    // Take 3: the paper-bag "creature" creeps along the fence on all fours-ish toward the friend.
    const target = new THREE.Vector3(FRIEND_POS.x - .75, .1, FRIEND_POS.z + .3);
    if (this.creeping && this.actressPos.distanceTo(target) > .12) {
      const dir = target.clone().sub(this.actressPos).setY(0).normalize();
      this.actressPos.addScaledVector(dir, dt * .42);
      actress.group.rotation.y = yawToward(0, 0, dir.x, dir.z);
      actress.play('creep', .4, .62);
    } else if (this.creeping) {
      // Reached him: the creature rears up, the victim turns and flinches.
      actress.play('idle', .35); this.turn(actress, FRIEND_POS.x, FRIEND_POS.z, 4, dt);
      if (!this.scared) friend.play('startle', .15);
      this.scared = Math.min(1, this.scared + dt / 1.1);
      this.turn(friend, this.actressPos.x, this.actressPos.z, 7, dt);
    } else if (this.cut) {
      actress.play('idle', .5); this.turn(actress, cam.x, cam.z, 2.2, dt);
      if (friend.current === 'startle' && this.t > 1.2) friend.play('idle', .6, .8);
      this.turn(friend, this.directorPos.x, this.directorPos.z, 1.4, dt);
    }
    actress.group.position.copy(this.actressPos);
    // The director steps in from behind the camera, walks into frame and stops in front of the lens.
    if (this.directorWalk) {
      const stop = new THREE.Vector3(.7, 0, -1.25 + this.back * .55), toStop = stop.clone().sub(this.directorPos).setY(0);
      if (toStop.length() > .08 && this.phase !== 'fall') {
        const pace = this.directorArrived ? .45 : 1.25;
        toStop.normalize(); this.directorPos.addScaledVector(toStop, dt * pace);
        if (!this.directorArrived) { director.group.rotation.y = yawToward(0, 0, toStop.x, toStop.z); director.play('walk', .3, 1); }
        else { this.turn(director, cam.x, cam.z, 3, dt); director.play('walk', .35, .5); }
      } else if (this.phase === 'fall') {
        // He sees the operator vanish and lunges toward the kerb.
        const toward = new THREE.Vector3(cam.x, 0, CAMERA_START.z + KERB_DISTANCE).sub(this.directorPos).setY(0);
        if (toward.length() > .6) { toward.normalize(); this.directorPos.addScaledVector(toward, dt * 2.6); director.play('jog', .2); this.turn(director, cam.x, CAMERA_START.z + KERB_DISTANCE, 8, dt); }
      } else {
        this.directorArrived = true;
        this.turn(director, cam.x, cam.z, 3, dt);
        this.directorTalk -= dt;
        if (director.current !== 'interact' || this.directorTalk < 0) director.play(this.subtitle?.speaker === DIRECTOR ? 'talk' : 'idle', .45);
      }
      director.group.position.set(this.directorPos.x, 0, this.directorPos.z);
    }
    for (const member of [director, actress, friend]) member.update(dt);
  }

  /** Point the operator would frame right now, before handheld lag. */
  private subject() {
    const { director, actress, friend } = this.cast;
    const head = (member: CastMember, y: number) => new THREE.Vector3(member.group.position.x, y, member.group.position.z);
    if (this.phase === 'play' || !this.cut) {
      // Tight on the creature, drifting toward the victim as she closes in.
      return head(actress, .95).lerp(head(friend, 1.25), .35 + this.scared * .25);
    }
    if (!this.directorArrived && this.directorWalk) return head(director, 1.45).lerp(head(actress, 1.2), .45);
    if (this.phase === 'backup' || this.phase === 'fall') return head(director, 1.35).lerp(head(actress, 1.15), .3 + this.back * .08);
    return head(director, 1.5).lerp(head(actress, 1.3), .2);
  }

  private animateCamera(dt: number) {
    const time = this.total, random = this.random;
    const position = CAMERA_START.clone(); position.z += this.back;
    const moving = this.phase === 'backup' && (this.backHeld || this.promptAt > 6) && this.back < KERB_DISTANCE;
    // Shoulder-held camcorder: breathing, layered tremor, footsteps, and occasional grip corrections.
    const sway = (f: number, p: number) => Math.sin(time * f + p) * .6 + Math.sin(time * f * 2.13 + p * 1.7) * .3 + Math.sin(time * f * 4.71 + p * .3) * .1;
    this.joltTimer -= dt;
    if (this.joltTimer <= 0) { this.joltTimer = 1.4 + random() * 3.2; this.jolt.set((random() - .5) * .05, (random() - .5) * .04, (random() - .5) * .05); }
    this.jolt.multiplyScalar(Math.exp(-dt * 5));
    const walk = moving ? 1 : 0, bob = walk * Math.sin(this.back * 11);
    position.y += bob * .032 + sway(1.1, 0) * .012;
    position.x += sway(.7, 2) * .02 + walk * Math.sin(this.back * 5.5) * .02;
    // Operator lag: a damped spring chases the subject, so pans overshoot and settle like a person.
    const desired = this.subject();
    const accel = desired.sub(this.aim).multiplyScalar(14).addScaledVector(this.aimVelocity, -6.5);
    this.aimVelocity.addScaledVector(accel, Math.min(dt, .05)); this.aim.addScaledVector(this.aimVelocity, Math.min(dt, .05));
    let pitch = sway(1.0, 1) * .016 + this.jolt.x + this.lookPitch + bob * .01;
    let yaw = sway(.8, 4) * .022 + this.jolt.y + this.lookYaw;
    let roll = sway(.6, 3) * .02 + this.jolt.z + walk * Math.sin(this.back * 5.5) * .018;
    // Zoom: punched in on the creature during the take, out to the wide as the director asks for it.
    const zoom = !this.cut ? 40 : this.phase === 'backup' || this.phase === 'fall' ? 60 : 52;
    this.fov += (zoom - this.fov) * Math.min(1, dt * (this.cut ? 1.1 : 2));
    if (Math.abs(this.camera.fov - this.fov) > .01) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }
    if (this.phase === 'fall') {
      const tip = smooth(0, .5, this.t), sink = Math.max(0, this.t - .45);
      position.z += tip * .3; position.y -= tip * .42 + sink * sink * 2.4;
      pitch += tip * 1.15 + Math.sin(this.t * 31) * .03 * tip; roll += tip * .55; yaw += Math.sin(this.t * 17) * .04 * tip;
    }
    this.camera.position.copy(position);
    this.camera.lookAt(this.aim);
    const base = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.camera.rotation.set(base.x + pitch, base.y + yaw, roll, 'YXZ');
  }

  dispose() {
    this.audio.stopIntro(.2);
    Object.values(this.cast).forEach(member => member.dispose());
    this.disposables.forEach(item => item.dispose());
    this.envTarget?.dispose();
    this.scene.clear();
  }
}
