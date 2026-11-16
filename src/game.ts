import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CELL, WALL_HEIGHT, MAP_SIZE, SPAWN, FUSE_CELLS, PANEL_CELL, EXIT_CELL, canStand, clearSight, createMap, seededRandom } from './level';
import type { Cell } from './level';
import { MimicBrain } from '../shared/mimic';
import type { Actor, ClientMessage, Pose, RoomView } from '../shared/protocol';
import { ExplorerAvatar, createViewArm } from './avatar';
import { createTorch, createFuse, createSwitchboard, createArchive, wornMetalTexture } from './props';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FirstPersonMotion } from './motion';
import { TensionDirector, FIELD_NOTES } from './tension';
import { enrichEnvironment } from './environment';
import { wallpaperTexture, carpetTexture, ceilingTexture, labelTexture, stainTexture, surfaceMaps, cardboardTexture } from './textures';
import { Soundscape } from './audio';
import type { Settings } from './settings';

export type GameState = 'menu' | 'playing' | 'paused' | 'dead' | 'won';
export type Snapshot = {
  elapsed: number;
  fuses: number;
  powered: boolean;
  stamina: number;
  moving: boolean;
  flashlight: boolean;
  danger: number;
  interaction: { type: string; label: string; action: string } | null;
  hint: { x: number; y: number; distance: number; behind: boolean } | null;
};
type Interactable = { type: 'fuse' | 'panel' | 'exit' | 'note'; position: THREE.Vector3; object: THREE.Group; index: number; taken: boolean };
type LightFixture = { position: THREE.Vector3; strength: number; flicker: boolean };
type Callbacks = {
  onState: (state: GameState) => void;
  onUpdate: (snapshot: Snapshot) => void;
  onMessage: (text: string, title?: string) => void;
};

const FilmShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    grain: { value: 0.016 },
    danger: { value: 0 },
    resolution: { value: new THREE.Vector2(1920, 1080) },
  },
  vertexShader: `varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float grain;
    uniform float danger;
    uniform vec2 resolution;
    varying vec2 vUv;
    float random(vec2 p) { return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      vec2 p = (uv - 0.5) * 2.0;
      uv = 0.5 + (uv - 0.5) * (1.0 + 0.008 * dot(p,p));
      float noise = random(floor(uv * resolution) + fract(time) * 987.0) - 0.5;
      float shift = (0.00055 + danger * 0.003) * dot(p,p);
      vec3 color;
      color.r = texture2D(tDiffuse, uv + vec2(shift,0.0)).r;
      color.g = texture2D(tDiffuse, uv).g;
      color.b = texture2D(tDiffuse, uv - vec2(shift,0.0)).b;
      float luminance = dot(color, vec3(0.2126,0.7152,0.0722));
      color = mix(color, vec3(luminance), 0.12);
      color *= vec3(1.025, 1.012, 0.955);
      float vignette = 1.0 - smoothstep(0.25, 1.45, length(p * vec2(0.83, 0.92))) * 0.63;
      color *= vignette;
      color += noise * (grain * (0.32 + min(luminance, 1.0) * 0.68) + danger * 0.06);
      color *= 0.994 + sin(uv.y * resolution.y * 1.7) * 0.006;
      color = mix(color, vec3(noise + 0.32), danger * 0.035);
      gl_FragColor = vec4(color,1.0);
    }`,
};

export class BackroomsGame {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(64, 1, 0.045, 95);
  readonly audio = new Soundscape();
  readonly map = createMap();
  readonly isTouch = matchMedia('(pointer: coarse)').matches;
  state: GameState = 'menu';
  elapsed = 0;
  fuses = 0;
  powered = false;
  private composer: EffectComposer;
  private film: ShaderPass;
  private settings: Settings;
  private callbacks: Callbacks;
  private keys = new Set<string>();
  private yaw = -2.65;
  private pitch = 0;
  private time = 0;
  private lastTime = 0;
  private uiTime = 0;
  private stamina = 1;
  private exhausted = false;
  private stepTime = 0;
  private motion = new FirstPersonMotion();
  private motionPose = this.motion.update(0, false, false, 0, false, false);
  private viewArm?: ReturnType<typeof createViewArm>;
  private pickupDip = 0;
  private tension = new TensionDirector();
  private lightLevel = 1;
  private tubeMaterial?: THREE.MeshStandardMaterial;
  private ambientLights: THREE.Light[] = [];
  private panelLamps: THREE.Mesh[] = [];
  private panelLever?: THREE.Group;
  private wetZones: THREE.Vector2[] = [];
  private danger = 0;
  private flashOn = true;
  private flashlight: THREE.SpotLight;
  private flashlightModel = new THREE.Group();
  private fixtures: LightFixture[] = [];
  private lights: THREE.PointLight[] = [];
  private interactables: Interactable[] = [];
  private target: Interactable | null = null;
  private exitSign?: THREE.Mesh;
  private panelIndicator?: THREE.Mesh;
  private dust: THREE.Points;
  private entity!: THREE.Group;
  private mimicVisual!: ExplorerAvatar;
  private mimicBrain?: MimicBrain;
  private entityActive = false;
  private entityStepTime = 0;
  coop = false;
  chatFocused = false;
  private selfId = '';
  private coopRound = -1;
  private networkSend?: (message: ClientMessage) => void;
  private poseTime = 0;
  private poseSequence = 0;
  private lastMoving = false;
  private lastSprint = false;
  private remoteVisuals = new Map<string, { visual: ExplorerAvatar; actor: Actor; step: number }>();
  private hintUntil = 0;
  private dragLook = false;
  private hadPointerLock = false;
  private skipMouseMoves = 0;
  private virtualMovement = new THREE.Vector2();
  private virtualSprint = false;
  private obstacles: { x: number; z: number; w: number; d: number }[] = [];
  private menuPosition = new THREE.Vector3(CELL * 3.55, 1.61, CELL * 3.6);
  private menuLookAt = new THREE.Vector3(CELL * 8.5, 1.45, CELL * 10.8);
  private animationId = 0;
  private needsRender = true;
  private menuAnimated = true;
  private lastBackgroundRender = -1;
  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, settings: Settings, callbacks: Callbacks) {
    this.settings = settings;
    this.callbacks = callbacks;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x242318);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'game-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Трёхмерный лабиринт Backrooms');
    container.appendChild(this.renderer.domElement);
    this.scene.fog = new THREE.FogExp2(0x282c21, 0.023);
    this.scene.background = new THREE.Color(0x282c21);
    this.scene.add(this.camera);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1024, 768), 0.23, 0.7, 1.05);
    this.composer.addPass(bloom);
    this.film = new ShaderPass(FilmShader);
    this.composer.addPass(this.film);
    this.composer.addPass(new OutputPass());

    this.buildArchitecture();
    this.buildFixtures();
    this.buildDetails();
    enrichEnvironment(this.scene, this.map);
    this.buildObjectives();
    this.buildEntity();

    this.flashlight = new THREE.SpotLight(0xfff2d5, 37, 25, 0.40, 0.62, 1.4);
    // Put the emitter just beyond the lens, not behind the view-model: otherwise
    // the hand is lit by its own high-intensity spotlight at centimetre range.
    this.flashlight.position.set(-0.24, -0.2, -0.65);
    const beam = document.createElement('canvas'); beam.width = beam.height = 256;
    const b = beam.getContext('2d')!, gradient = b.createRadialGradient(128, 128, 1, 128, 128, 128);
    gradient.addColorStop(0, '#ffffff'); gradient.addColorStop(.3, '#eeeeea'); gradient.addColorStop(.55, '#c5c5bf'); gradient.addColorStop(.78, '#8c8d85'); gradient.addColorStop(1, '#000000');
    b.fillStyle = gradient; b.fillRect(0, 0, 256, 256);
    this.flashlight.map = new THREE.CanvasTexture(beam);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.set(1024, 1024);
    this.flashlight.shadow.bias = -0.00025;
    this.flashlight.shadow.normalBias = 0.03;
    this.flashlight.shadow.camera.near = 0.2;
    const aim = new THREE.Object3D();
    aim.position.set(0, -0.1, -10);
    this.camera.add(aim);
    this.flashlight.target = aim;
    this.camera.add(this.flashlight);
    this.flashlight.visible = false;
    this.buildFlashlight();

    const random = seededRandom(987);
    const particles = new Float32Array(650 * 3);
    for (let i = 0; i < particles.length; i += 3) {
      particles[i] = random() * MAP_SIZE * CELL;
      particles[i + 1] = 0.15 + random() * 2.6;
      particles[i + 2] = random() * MAP_SIZE * CELL;
    }
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(particles, 3));
    this.dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0xd8d0a1, size: 0.015, transparent: true, opacity: 0.25, depthWrite: false }));
    this.scene.add(this.dust);

    this.bindInput();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.applySettings(settings);
    this.resize();
    this.animationId = requestAnimationFrame(this.frame);
  }

  private buildArchitecture() {
    const wallTex = wallpaperTexture();
    const wallMaterial = new THREE.MeshStandardMaterial({ map: wallTex, ...surfaceMaps(wallTex, 2.2, .91), normalScale: new THREE.Vector2(.65, .65), roughness: 1, color: 0xf3e9c3 });
    const floorTex = carpetTexture();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(MAP_SIZE * CELL, MAP_SIZE * CELL), new THREE.MeshStandardMaterial({ map: floorTex, ...surfaceMaps(floorTex, 3, .98), normalScale: new THREE.Vector2(.8, .8), roughness: 1, color: 0xc3bc9b }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((MAP_SIZE - 1) * CELL / 2, 0, (MAP_SIZE - 1) * CELL / 2);
    floor.receiveShadow = true;
    this.scene.add(floor);
    const ceilingTex = ceilingTexture();
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(MAP_SIZE * CELL, MAP_SIZE * CELL), new THREE.MeshStandardMaterial({ map: ceilingTex, ...surfaceMaps(ceilingTex, 1.6, .96), roughness: 1, color: 0xd4d5bf }));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.copy(floor.position).setY(WALL_HEIGHT);
    ceiling.receiveShadow = true;
    this.scene.add(ceiling);

    const walls: THREE.BufferGeometry[] = [];
    const trims: THREE.BufferGeometry[] = [];
    const crowns: THREE.BufferGeometry[] = [];
    for (let z = 1; z < MAP_SIZE - 1; z++) {
      for (let x = 1; x < MAP_SIZE - 1; x++) {
        if (!this.map[z][x]) continue;
        const exposed = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => this.map[z + dz]?.[x + dx] === false);
        if (!exposed.length) continue;
        walls.push(new THREE.BoxGeometry(CELL, WALL_HEIGHT, CELL).translate(x * CELL, WALL_HEIGHT / 2, z * CELL));
        for (const [dx, dz] of exposed) {
          const tx = x * CELL + dx * (CELL / 2 + 0.016);
          const tz = z * CELL + dz * (CELL / 2 + 0.016);
          trims.push(new THREE.BoxGeometry(dx ? 0.035 : CELL, 0.13, dz ? 0.035 : CELL).translate(tx, 0.065, tz));
          crowns.push(new THREE.BoxGeometry(dx ? 0.035 : CELL, 0.042, dz ? 0.035 : CELL).translate(tx, WALL_HEIGHT - 0.021, tz));
        }
      }
    }
    const wallMesh = new THREE.Mesh(mergeGeometries(walls), wallMaterial);
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    this.scene.add(wallMesh);
    const baseboard = new THREE.Mesh(mergeGeometries(trims), new THREE.MeshStandardMaterial({ color: 0x504931, roughness: 0.88 }));
    baseboard.receiveShadow = true;
    this.scene.add(baseboard);
    this.scene.add(new THREE.Mesh(mergeGeometries(crowns), new THREE.MeshStandardMaterial({ color: 0x858269, roughness: 1 })));
    [...walls, ...trims, ...crowns].forEach(geometry => geometry.dispose());

    this.ambientLights = [new THREE.HemisphereLight(0xb8c6ac, 0x3b341c, .48), new THREE.AmbientLight(0xb3b08b, .13)];
    this.scene.add(...this.ambientLights);
  }

  private buildFixtures() {
    const fixtureCells: Cell[] = [
      { x: 4, z: 3 }, { x: 4, z: 6 }, { x: 8, z: 5 }, { x: 8, z: 9 },
      { x: 5, z: 10 }, { x: 11, z: 5 }, { x: 14, z: 6 },
    ];
    for (let z = 3; z < 25; z += 3) {
      for (let x = 3; x < 25; x += 3) {
        if (!this.map[z][x] && !fixtureCells.some(c => Math.hypot(c.x - x, c.z - z) < 2)) fixtureCells.push({ x, z });
      }
    }
    const frames: THREE.BufferGeometry[] = [];
    const backs: THREE.BufferGeometry[] = [];
    const bulbs: THREE.BufferGeometry[] = [];
    const random = seededRandom(73);
    fixtureCells.forEach((cell, index) => {
      const x = cell.x * CELL;
      const z = cell.z * CELL;
      const horizontal = index % 3 === 0;
      const w = horizontal ? 1.22 : 0.5;
      const d = horizontal ? 0.5 : 1.22;
      frames.push(new THREE.BoxGeometry(w + 0.085, 0.075, d + 0.085).translate(x, WALL_HEIGHT - 0.055, z));
      backs.push(new THREE.BoxGeometry(w, 0.012, d).translate(x, WALL_HEIGHT - 0.097, z));
      for (const offset of [-0.13, 0.13]) {
        bulbs.push(new THREE.BoxGeometry(horizontal ? 1.09 : 0.065, 0.023, horizontal ? 0.065 : 1.09).translate(x + (horizontal ? 0 : offset), WALL_HEIGHT - 0.11, z + (horizontal ? offset : 0)));
      }
      this.fixtures.push({ position: new THREE.Vector3(x, WALL_HEIGHT - 0.23, z), strength: 14 + random() * 6, flicker: index % 9 === 4 });
    });
    this.scene.add(new THREE.Mesh(mergeGeometries(frames), new THREE.MeshStandardMaterial({ color: 0x777660, roughness: 0.58, metalness: 0.3 })));
    this.scene.add(new THREE.Mesh(mergeGeometries(backs), new THREE.MeshStandardMaterial({ color: 0xdbd9be, emissive: 0xc6cfaa, emissiveIntensity: 0.38, roughness: 0.5 })));
    this.tubeMaterial = new THREE.MeshStandardMaterial({ color: 0xf4f8de, emissive: 0xf1ffce, emissiveIntensity: 3.6 });
    this.scene.add(new THREE.Mesh(mergeGeometries(bulbs), this.tubeMaterial));
    [...frames, ...backs, ...bulbs].forEach(geometry => geometry.dispose());
    for (let i = 0; i < 10; i++) {
      const light = new THREE.PointLight(i % 3 ? 0xfff0c9 : 0xdeedc3, 16, 10.8, 1.7);
      this.lights.push(light);
      this.scene.add(light);
    }
  }

  private buildDetails() {
    const random = seededRandom(28);
    const stain = stainTexture();
    for (let i = 0; i < 60; i++) {
      const x = 2 + Math.floor(random() * 23);
      const z = 2 + Math.floor(random() * 23);
      if (this.map[z][x]) continue;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 + random() * 3, 2 + random() * 3), new THREE.MeshBasicMaterial({ map: stain, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = random() * Math.PI;
      mesh.position.set(x * CELL, 0.007, z * CELL);
      this.scene.add(mesh);
    }
    const damp = new THREE.MeshPhysicalMaterial({ map: stain, transparent: true, opacity: .28, roughness: .19, metalness: .04, clearcoat: .7, clearcoatRoughness: .25, depthWrite: false, color: 0x666747 });
    for (const [x, z] of [[4, 7], [8, 12], [5, 17], [13, 6], [18, 15], [23, 18]]) {
      const patch = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.1), damp);
      patch.rotation.x = -Math.PI / 2; patch.rotation.z = random() * 3;
      patch.position.set(x * CELL, .013, z * CELL); this.scene.add(patch);
      this.wetZones.push(new THREE.Vector2(x * CELL, z * CELL));
    }
    const ventMaterial = new THREE.MeshStandardMaterial({ color: 0x777361, roughness: 0.7, metalness: 0.35 });
    for (const [x, z] of [[3, 5], [8, 8], [12, 3], [5, 18], [21, 10], [15, 20]]) {
      const vent = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.035, 0.56), ventMaterial);
      vent.add(frame);
      for (let i = 0; i < 9; i++) {
        const slot = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.008, 0.023), new THREE.MeshStandardMaterial({ color: 0x24241e, roughness: 1 }));
        slot.position.set(0, -0.022, -0.2 + i * 0.05);
        vent.add(slot);
      }
      vent.position.set(x * CELL, WALL_HEIGHT - 0.03, z * CELL);
      this.scene.add(vent);
    }
    // Discarded cardboard and a fallen office chair make the rooms feel abandoned.
    for (const [x, z] of [[7.55, 5.4], [4.6, 10.1], [12, 11.9], [18.6, 9.6], [8, 23.4]]) {
      this.addBox(x * CELL, z * CELL, 0.62, 0.5, 0.54);
      if (x > 7) this.addBox(x * CELL + 0.48, z * CELL + 0.1, 0.42, 0.33, 0.42);
    }
    const chair = new THREE.Group();
    const fabric = new THREE.MeshStandardMaterial({ color: 0x383a2d, roughness: 1 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x373a34, metalness: 0.6, roughness: 0.6 });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.49, 0.085, 0.49), fabric);
    seat.position.y = 0.48;
    chair.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.45, 0.075), fabric);
    back.position.set(0, 0.75, 0.22);
    chair.add(back);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.43, 7), metal);
    stem.position.y = 0.24;
    chair.add(stem);
    for (let i = 0; i < 5; i++) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.035, 0.52), metal);
      leg.position.y = 0.055;
      leg.rotation.y = i * Math.PI / 5;
      chair.add(leg);
    }
    chair.rotation.z = Math.PI / 2.3;
    chair.rotation.y = 0.8;
    chair.position.set(8.2 * CELL, 0.22, 10.9 * CELL);
    this.scene.add(chair);

    const writingCanvas = document.createElement('canvas');
    writingCanvas.width = 1024;
    writingCanvas.height = 512;
    const ctx = writingCanvas.getContext('2d')!;
    ctx.translate(512, 256);
    ctx.rotate(-0.035);
    ctx.font = '600 83px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(69,49,28,0.72)';
    ctx.fillText('ТЫ ЗДЕСЬ', 0, -15);
    ctx.fillText('НЕ ОДИН', 0, 80);
    ctx.strokeStyle = 'rgba(69,49,28,0.6)';
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(-140, 128); ctx.lineTo(95, 116); ctx.stroke();
    const writing = new THREE.CanvasTexture(writingCanvas);
    const graffiti = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.9), new THREE.MeshBasicMaterial({ map: writing, transparent: true, opacity: 0.75, depthWrite: false }));
    graffiti.position.set(6 * CELL - CELL / 2 - 0.015, 1.47, 4.4 * CELL);
    graffiti.rotation.y = -Math.PI / 2;
    this.scene.add(graffiti);
  }

  private addBox(x: number, z: number, width: number, height: number, depth: number) {
    const box = new THREE.Group();
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 2, .012), new THREE.MeshStandardMaterial({ color: 0xb6a778, map: cardboardTexture(), roughness: .98 }));
    mesh.position.y = height / 2;
    mesh.castShadow = true;
    box.add(mesh);
    const tape = new THREE.Mesh(new THREE.BoxGeometry(width * 0.16, 0.002, depth + 0.003), new THREE.MeshStandardMaterial({ color: 0xa18d58, roughness: 0.55 }));
    tape.position.y = height + 0.002;
    box.add(tape);
    const shipping = new THREE.Mesh(new THREE.PlaneGeometry(width * .57, height * .34), new THREE.MeshStandardMaterial({ map: labelTexture('↑ ↑  /  019', '#555840', '#b6b38f'), roughness: 1 }));
    shipping.position.set(0, height * .56, depth / 2 + .013); box.add(shipping);
    box.position.set(x, 0, z);
    this.scene.add(box);
    this.obstacles.push({ x, z, w: width / 2 + 0.19, d: depth / 2 + 0.19 });
    return box;
  }

  private buildObjectives() {
    const steel = new THREE.MeshStandardMaterial({ color: 0x889280, map: wornMetalTexture(), roughness: .46, metalness: .7 });
    FUSE_CELLS.forEach((cell, index) => {
      const position = new THREE.Vector3(cell.x * CELL, .765, cell.z * CELL);
      this.addBox(position.x, position.z, .8, .62, .65);
      const group = createFuse(index); group.position.copy(position); this.scene.add(group);
      this.interactables.push({ type: 'fuse', position, object: group, index, taken: false });
    });
    const switchboard = createSwitchboard(), panel = switchboard.group;
    this.panelIndicator = switchboard.indicator; this.panelLamps = switchboard.lamps; this.panelLever = switchboard.lever;
    panel.position.set(PANEL_CELL.x * CELL, 1.36, (PANEL_CELL.z - .5) * CELL + .1);
    this.scene.add(panel);
    this.interactables.push({ type: 'panel', position: panel.position.clone(), object: panel, index: -1, taken: false });
    FIELD_NOTES.forEach((note, index) => {
      const position = new THREE.Vector3(note.x * CELL, .51, note.z * CELL);
      this.addBox(position.x, position.z, .45, .49, .48);
      const group = createArchive(index); group.position.copy(position); group.rotation.y = index * .6 + .2; this.scene.add(group);
      this.interactables.push({ type: 'note', position, object: group, index, taken: false });
    });
    const exit = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.55, 2.49, 0.14), new THREE.MeshStandardMaterial({ color: 0x33392f, roughness: 0.75, metalness: 0.25 }));
    frame.position.y = 1.245;
    exit.add(frame);
    const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x696b54, roughness: 0.7, metalness: 0.28 });
    for (const side of [-1, 1]) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.69, 2.3, 0.04), doorMaterial);
      door.position.set(side * 0.36, 1.18, 0.093);
      exit.add(door);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.035, 0.045), steel);
      handle.position.set(side * 0.14, 1.1, 0.14);
      exit.add(handle);
      const kickplate = new THREE.Mesh(new THREE.BoxGeometry(0.63, 0.22, 0.01), steel);
      kickplate.position.set(side * 0.36, 0.25, 0.12);
      exit.add(kickplate);
    }
    this.exitSign = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 0.27), new THREE.MeshBasicMaterial({ map: labelTexture('ВЫХОД  →', '#c5c8a0', '#3e4c34') }));
    this.exitSign.position.set(0, 2.67, 0.10);
    exit.add(this.exitSign);
    exit.position.set(EXIT_CELL.x * CELL, 0, (EXIT_CELL.z - 0.5) * CELL + 0.1);
    this.scene.add(exit);
    this.interactables.push({ type: 'exit', position: exit.position.clone().setY(1.35), object: exit, index: -1, taken: false });
  }

  private buildFlashlight() {
    this.flashlightModel.name = 'FirstPersonFlashlight';
    const torch = createTorch(); this.flashlightModel.add(torch);
    this.viewArm = createViewArm(); this.flashlightModel.add(this.viewArm.root);
    this.flashlightModel.scale.setScalar(.95);
    this.flashlightModel.position.set(-.25, -.27, -.48);
    this.flashlightModel.visible = false; this.camera.add(this.flashlightModel);
  }

  private updateFlashlight(dt: number) {
    if (this.state === 'menu' || this.state === 'dead' || this.state === 'won') return;
    // Continue the draw/holster transition while paused, without moving the player.
    if (this.state === 'paused') this.motionPose = this.motion.update(dt, false, false, 0, false, this.flashOn);
    const p = this.motionPose, lower = 1 - p.draw;
    this.pickupDip = Math.max(0, this.pickupDip - dt * 2.5);
    this.flashlightModel.visible = p.visible;
    this.flashlightModel.position.set(-.25 + p.handX, -.27 + p.handY - lower * .56 - Math.sin(this.pickupDip * Math.PI) * .06, -.48 + lower * .13);
    this.flashlightModel.rotation.set(lower * 1.15, -.04 + p.handYaw, p.handRoll - lower * .25);
    if (this.state === 'paused' && this.motion.raised !== (this.flashOn ? 1 : 0)) this.needsRender = true;
  }

  private syncObjectiveVisuals() {
    if (this.panelIndicator) (this.panelIndicator.material as THREE.MeshBasicMaterial).color.setHex(this.powered ? 0xa8e9ab : 0xac6240);
    if (this.exitSign) (this.exitSign.material as THREE.MeshBasicMaterial).color.setHex(this.powered ? 0xa2ffb8 : 0xffffff);
    this.panelLamps.forEach((lamp, i) => (lamp.material as THREE.MeshBasicMaterial).color.setHex(i < this.fuses ? 0xa4d997 : 0x743b28));
    if (this.panelLever) this.panelLever.rotation.x = this.powered ? -.65 : .15;
  }

  private buildEntity() {
    this.mimicVisual = new ExplorerAvatar();
    this.entity = this.mimicVisual.group;
    this.entity.visible = false;
    this.scene.add(this.entity);
  }

  private bindInput() {
    window.addEventListener('keydown', event => {
      if (this.state !== 'playing' || this.chatFocused || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(event.code)) event.preventDefault();
      this.keys.add(event.code);
      if (event.repeat) return;
      if (event.code === 'KeyE') this.interact();
      if (event.code === 'KeyF') this.toggleFlashlight();
      if (event.code === 'KeyH') this.showHint();
      if (event.code === 'Escape' || event.code === 'KeyP') this.pause();
    });
    window.addEventListener('keyup', event => this.keys.delete(event.code));
    window.addEventListener('blur', () => { if (this.state === 'playing') this.pause(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(); });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.renderer.domElement;
      if (this.hadPointerLock && !locked && this.state === 'playing' && !this.chatFocused) this.pause();
      if (locked) this.skipMouseMoves = 2;
      this.hadPointerLock = locked;
    });
    document.addEventListener('mousemove', event => {
      if (this.state !== 'playing' || this.chatFocused || (document.pointerLockElement !== this.renderer.domElement && !this.dragLook)) return;
      // Some browsers report the cursor warp into pointer lock as a huge relative
      // movement. It must not fling the player toward the floor or ceiling.
      if (this.skipMouseMoves > 0) { this.skipMouseMoves--; return; }
      if (Math.abs(event.movementX) > 180 || Math.abs(event.movementY) > 180) return;
      this.look(event.movementX, event.movementY);
    });
    this.renderer.domElement.addEventListener('mousedown', event => {
      if (this.state === 'playing' && event.button === 0) {
        this.dragLook = true;
        if (!document.pointerLockElement) this.capturePointer();
      }
    });
    window.addEventListener('mouseup', () => { this.dragLook = false; });
    this.renderer.domElement.addEventListener('contextmenu', event => event.preventDefault());
  }

  async capturePointer() {
    if (this.isTouch || this.state !== 'playing') return;
    try {
      if (document.pointerLockElement !== this.renderer.domElement) await this.renderer.domElement.requestPointerLock();
    } catch {
      this.callbacks.onMessage('Зажмите левую кнопку мыши и двигайте ею для осмотра.', 'РЕЖИМ БЕЗ ЗАХВАТА КУРСОРА');
    }
  }

  look(dx: number, dy: number) {
    if (this.state !== 'playing') return;
    const sensitivity = 0.0007 + this.settings.sensitivity * 0.003;
    this.motion.look(-dx * sensitivity, -dy * sensitivity);
    this.yaw -= dx * sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * sensitivity, -1.42, 1.42);
  }

  setVirtualMovement(x: number, y: number) { this.virtualMovement.set(x, y); }
  setVirtualSprint(active: boolean) { this.virtualSprint = active; }

  start() {
    this.elapsed = 0;
    this.fuses = 0;
    this.powered = false;
    this.stamina = 1;
    this.exhausted = false;
    this.entityActive = false;
    this.entity.visible = false;
    this.mimicBrain = undefined;
    this.entityStepTime = 0;
    this.stepTime = 0;
    this.target = null;
    this.danger = 0;
    this.pitch = 0;
    this.yaw = -2.65;
    this.motion.reset(); this.pickupDip = 0;
    this.lightLevel = 1; this.tension.reset(7813);
    this.mimicVisual.reset();
    this.hintUntil = 0;
    this.flashOn = true;
    this.chatFocused = false;
    this.camera.position.set(SPAWN.x * CELL, 1.63, SPAWN.z * CELL);
    this.camera.rotation.set(0, this.yaw, 0, 'YXZ');
    this.camera.fov = 72;
    this.camera.updateProjectionMatrix();
    this.interactables.filter(item => item.type === 'fuse' || item.type === 'note').forEach(item => {
      item.taken = false;
      item.object.visible = true;
    });
    this.syncObjectiveVisuals();
    this.flashlight.visible = true;
    this.flashlightModel.visible = false;
    this.setState('playing');
    void this.audio.unlock().then(() => this.audio.setActive(this.state === 'playing'));
    this.callbacks.onMessage(this.coop ? 'Предохранители общие. Не теряйте напарников. Enter / T — чат, Q — короткий сигнал.' : 'Найдите три предохранителя. Восстановите питание щитка у входа.', this.coop ? 'КООПЕРАТИВ · MIMIC' : 'ВЫ НЕ ПОМНИТЕ, КАК СЮДА ПОПАЛИ');
  }

  pause() {
    if (this.state !== 'playing') return;
    this.setState('paused');
    if (document.pointerLockElement) document.exitPointerLock();
    this.audio.setActive(this.coop);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.setState('playing');
    void this.audio.unlock().then(() => this.audio.setActive(this.state === 'playing'));
    void this.capturePointer();
  }

  menu() {
    this.setState('menu'); this.menuAnimated = true;
    if (document.pointerLockElement) document.exitPointerLock();
    this.audio.setActive(false);
    this.lightLevel = 1; this.motion.reset();
    this.flashlight.visible = false;
    this.flashlightModel.visible = false;
    this.entity.visible = false;
    for (const remote of this.remoteVisuals.values()) remote.visual.group.visible = false;
    this.chatFocused = false;
    this.camera.fov = 64;
    this.camera.updateProjectionMatrix();
  }

  private setState(state: GameState) {
    this.state = state;
    this.needsRender = true;
    this.keys.clear();
    this.virtualMovement.set(0, 0);
    this.virtualSprint = false;
    this.dragLook = false;
    this.callbacks.onState(state);
  }

  toggleFlashlight() {
    if (this.state !== 'playing') return;
    this.flashOn = !this.flashOn;
    this.flashlight.visible = this.flashOn;
    this.audio.toggle();
  }

  showHint() {
    if (this.state !== 'playing') return;
    this.hintUntil = this.elapsed + 12;
    this.audio.hint();
    this.callbacks.onMessage(this.fuses < 3 ? 'Метка указывает на ближайший предохранитель. Ищите обход через соседние комнаты.' : this.powered ? 'Выход у входа теперь открыт.' : 'Вернитесь к электрическому щитку у входа.', 'СЛАБЫЙ СИГНАЛ · 12 СЕК');
  }

  interact() {
    if (this.state !== 'playing' || !this.target) return;
    const item = this.target;
    if (item.type === 'note') {
      item.taken = true; item.object.visible = false;
      const note = FIELD_NOTES[item.index]; this.audio.note(); this.pickupDip = 1;
      this.hintUntil = this.elapsed + 20;
      this.callbacks.onMessage(note.text, note.title + ' · ОРИЕНТИР 20 СЕК'); this.target = null;
      return; // Field notes are local discoveries, never spoof network objective actions.
    }
    if (this.coop) {
      this.networkSend?.({ t: 'interact', interaction: { kind: item.type, index: item.index } });
      this.target = null;
      return;
    }
    if (item.type === 'fuse') {
      item.taken = true;
      item.object.visible = false;
      this.fuses++; this.pickupDip = 1; this.syncObjectiveVisuals();
      this.audio.pickup();
      if (this.fuses === 1) {
        this.activateEntity();
        this.callbacks.onMessage('Первый предохранитель найден. В рации появился ещё один сигнал.', 'ПРЕДОХРАНИТЕЛЬ 01 / 03');
      } else if (this.fuses === 3) {
        this.callbacks.onMessage('Все предохранители найдены. Вернитесь к щитку у входа.', 'НЕ ОСТАНАВЛИВАЙТЕСЬ');
        this.hintUntil = this.elapsed + 15;
      } else this.callbacks.onMessage('Ещё один. Не идите на звук чужих шагов.', 'ПРЕДОХРАНИТЕЛЬ 02 / 03');
    } else if (item.type === 'panel') {
      if (this.fuses < 3) {
        this.callbacks.onMessage(`Не хватает предохранителей: ${this.fuses} из 3. Нажмите H, если заблудились.`, 'ПИТАНИЕ ОТКЛЮЧЕНО');
        this.audio.toggle();
      } else if (!this.powered) {
        this.powered = true;
        this.syncObjectiveVisuals(); this.pickupDip = 1;
        this.audio.powerOn();
        this.callbacks.onMessage('Питание восстановлено. Дверь рядом со щитком открыта. Уходите.', 'ВЫХОД ДОСТУПЕН');
        this.hintUntil = this.elapsed + 30;
      } else this.callbacks.onMessage('Дверь справа от щитка открыта.', 'ПИТАНИЕ ВОССТАНОВЛЕНО');
    } else if (item.type === 'exit') {
      this.audio.door(!this.powered);
      if (!this.powered) this.callbacks.onMessage('Электронный замок не отвечает. Найдите предохранители и включите щиток.', 'НЕТ ПИТАНИЯ');
      else this.finish(true);
    }
    this.target = null;
  }

  private activateEntity() {
    if (this.coop) return;
    this.mimicBrain = new MimicBrain(this.map, [this.localActor()], 'offline-companion', 7163 + Math.floor(this.elapsed));
    this.entityActive = true;
    this.mimicVisual.update(this.mimicBrain.actor, 0, this.time, true);
  }

  private finish(won: boolean) {
    this.setState(won ? 'won' : 'dead');
    if (document.pointerLockElement) document.exitPointerLock();
    this.audio.end(won);
    if (!won) this.danger = 1;
    this.flashlightModel.visible = false; this.flashlight.visible = false; this.motion.reset();
  }

  setMenuAnimation(active: boolean) { this.menuAnimated = active; this.needsRender = true; }

  private configureVisualQuality(root: THREE.Object3D = this.scene) {
    const detail = this.settings.quality !== 'low';
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        if (!material.userData.surfaceMaps) material.userData.surfaceMaps = { normal: material.normalMap, roughness: material.roughnessMap, clearcoat: material instanceof THREE.MeshPhysicalMaterial ? material.clearcoat : 0 };
        const maps = material.userData.surfaceMaps;
        const normal = detail ? maps.normal : null, roughness = detail ? maps.roughness : null;
        if (material.normalMap !== normal || material.roughnessMap !== roughness) { material.normalMap = normal; material.roughnessMap = roughness; material.needsUpdate = true; }
        if (material instanceof THREE.MeshPhysicalMaterial) { const clearcoat = detail ? maps.clearcoat : 0; if (material.clearcoat !== clearcoat) { material.clearcoat = clearcoat; material.needsUpdate = true; } }
      }
    });
    for (const item of this.interactables) if (item.type === 'fuse') item.object.traverse(object => { if (object instanceof THREE.PointLight) object.visible = detail; });
  }

  applySettings(settings: Settings) {
    this.settings = settings;
    this.audio.setVolume(settings.volume);
    this.audio.setMuted(settings.muted);
    this.film.uniforms.grain.value = settings.grain ? 0.014 : 0;
    const shadowSize = settings.quality === 'high' ? 1024 : 512;
    if (this.flashlight.shadow.mapSize.x !== shadowSize) { this.flashlight.shadow.mapSize.set(shadowSize, shadowSize); this.flashlight.shadow.map?.dispose(); this.flashlight.shadow.map = null; }
    this.renderer.shadowMap.enabled = settings.quality !== 'low';
    this.configureVisualQuality();
    this.resize();
  }

  private resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const scale = { high: 1, medium: 0.8, low: 0.57 }[this.settings.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * scale);
    this.renderer.setSize(width, height);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * scale);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.film.uniforms.resolution.value.set(width * scale, height * scale);
    this.needsRender = true;
  }

  private positionAllowed(x: number, z: number) {
    return canStand(this.map, x, z) && !this.obstacles.some(o => Math.abs(x - o.x) < o.w && Math.abs(z - o.z) < o.d);
  }

  private updatePlayer(dt: number) {
    const input = new THREE.Vector2(
      (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0) + this.virtualMovement.x,
      (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) - this.virtualMovement.y,
    );
    if (this.chatFocused) input.set(0, 0);
    if (input.length() > 1) input.normalize();
    const moving = input.length() > 0.1;
    if (this.stamina < 0.02) this.exhausted = true;
    if (this.stamina > 0.28) this.exhausted = false;
    const sprint = moving && !this.exhausted && this.stamina > 0 && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.virtualSprint);
    this.lastMoving = moving;
    this.lastSprint = sprint;
    this.stamina = THREE.MathUtils.clamp(this.stamina + dt * (sprint ? -0.16 : 0.115), 0, 1);
    const speed = sprint ? 4.15 : 2.35;
    const dx = (Math.cos(this.yaw) * input.x - Math.sin(this.yaw) * input.y) * speed * dt;
    const dz = (-Math.sin(this.yaw) * input.x - Math.cos(this.yaw) * input.y) * speed * dt;
    // Separate axes allow sliding along walls instead of getting stuck at corners.
    if (this.positionAllowed(this.camera.position.x + dx, this.camera.position.z)) this.camera.position.x += dx;
    if (this.positionAllowed(this.camera.position.x, this.camera.position.z + dz)) this.camera.position.z += dz;
    this.motionPose = this.motion.update(dt, moving, sprint, input.x, this.settings.headBob, this.flashOn);
    this.camera.position.y = 1.63 + this.motionPose.height;
    this.camera.rotation.set(this.pitch + this.motionPose.pitch, this.yaw, this.motionPose.roll, 'YXZ');
    this.camera.fov = this.motionPose.fov; this.camera.updateProjectionMatrix();
    if (moving) {
      this.stepTime += dt;
      if (this.stepTime > (sprint ? 0.3 : 0.49)) {
        this.stepTime = 0;
        this.audio.footstep(sprint, this.wetZones.some(p => Math.hypot(p.x - this.camera.position.x, p.y - this.camera.position.z) < 1.05));
      }
    } else this.stepTime = 0.25;

    if (!this.coop && this.entityActive) this.updateEntity(dt, sprint, moving);
    else if (!this.coop) this.danger = 0;
    this.audio.updateDanger(this.danger);
    this.audio.updateMotion(dt, this.stamina, sprint);
    this.flashlight.intensity = (this.powered ? 32 : 37) * (this.danger > .6 ? .91 + Math.sin(this.time * 4) * .09 : 1);
    this.target = this.findInteraction();
    return moving;
  }

  private localActor(): Actor {
    return { ...this.getPose(), id: this.selfId || 'local', name: 'Вы', skin: 0, alive: this.state !== 'dead' };
  }

  private updateEntity(dt: number, sprint: boolean, moving: boolean) {
    const brain = this.mimicBrain;
    if (!brain) return;
    const player = { ...this.localActor(), sprint, moving };
    const event = brain.tick(dt, [player], this.interactables.filter(i => i.type === 'fuse').map(i => i.taken), this.powered);
    this.mimicVisual.update(brain.actor, dt, this.time, true);
    const pos = this.entity.position;
    const distance = Math.hypot(player.x - pos.x, player.z - pos.z);
    const sight = clearSight(this.map, player.x, player.z, pos.x, pos.z);
    this.danger = brain.phase === 'revealed' ? Math.max(0, 1 - distance / 15) * (sight ? 1 : 0.55) : 0;
    if (brain.actor.moving) {
      this.entityStepTime += dt;
      if (this.entityStepTime > (brain.actor.sprint ? 0.32 : 0.49)) {
        this.entityStepTime = 0;
        const pan = ((pos.x - player.x) * Math.cos(this.yaw) - (pos.z - player.z) * Math.sin(this.yaw)) / Math.max(distance, 0.01);
        this.audio.creatureStep(distance, pan, !sight, brain.phase === 'revealed');
      }
    }
    if (event.speech) this.callbacks.onMessage(event.speech, brain.actor.name.toUpperCase() + ' / РАЦИЯ');
    if (event.revealedNow) { this.audio.reveal(); this.callbacks.onMessage('Это не ваш напарник. Бегите.', 'MIMIC / БИОСИГНАЛ НЕ СОВПАДАЕТ'); }
    if (event.victim) this.finish(false);
  }

  getPose(): Pose {
    return { x: this.camera.position.x, z: this.camera.position.z, yaw: Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw)), pitch: this.pitch,
      flashlight: this.flashOn, sprint: this.state === 'playing' && this.lastSprint, moving: this.state === 'playing' && !this.chatFocused && this.lastMoving };
  }

  setChatFocus(focused: boolean) {
    this.chatFocused = focused;
    this.keys.clear();
    if (focused) { if (document.pointerLockElement) document.exitPointerLock(); }
    else if (this.state === 'playing') void this.capturePointer();
  }

  enableCoop(selfId: string, send: (message: ClientMessage) => void) {
    this.coop = true;
    this.selfId = selfId;
    this.coopRound = -1;
    this.networkSend = send;
  }

  leaveCoop() {
    this.coop = false;
    this.selfId = '';
    this.coopRound = -1;
    this.networkSend = undefined;
    for (const remote of this.remoteVisuals.values()) remote.visual.dispose();
    this.remoteVisuals.clear();
    this.chatFocused = false;
  }

  applyRoom(room: RoomView) {
    if (!this.coop || room.phase === 'lobby') return;
    const own = room.actors.find(actor => actor.id === this.selfId);
    if (!own) return;
    if (room.round !== this.coopRound) {
      this.coopRound = room.round;
      for (const remote of this.remoteVisuals.values()) remote.visual.dispose();
      this.remoteVisuals.clear();
      this.start();
      this.tension.reset(room.round * 983 + [...room.code].reduce((n, c) => n + c.charCodeAt(0), 0));
      this.camera.position.x = own.x;
      this.camera.position.z = own.z;
    }
    this.elapsed = room.elapsed;
    const previousFuses = this.fuses;
    this.fuses = room.fuses.filter(Boolean).length;
    if (this.fuses > previousFuses) this.audio.pickup();
    const justPowered = !this.powered && room.powered;
    this.powered = room.powered;
    for (const item of this.interactables) if (item.type === 'fuse') { item.taken = room.fuses[item.index]; item.object.visible = !item.taken; }
    this.syncObjectiveVisuals();
    if (justPowered) this.audio.powerOn();
    if (Math.hypot(own.x - this.camera.position.x, own.z - this.camera.position.z) > 1.1) { this.camera.position.x = own.x; this.camera.position.z = own.z; }
    const ids = new Set(room.actors.map(actor => actor.id));
    for (const [id, remote] of this.remoteVisuals) if (!ids.has(id)) { remote.visual.dispose(); this.remoteVisuals.delete(id); }
    for (const actor of room.actors) {
      if (actor.id === this.selfId) continue;
      let remote = this.remoteVisuals.get(actor.id);
      if (!remote) {
        const visual = new ExplorerAvatar();
        this.scene.add(visual.group); this.configureVisualQuality(visual.group);
        remote = { visual, actor, step: 0 };
        this.remoteVisuals.set(actor.id, remote);
      }
      if (actor.revealed && !remote.actor.revealed) this.audio.reveal();
      remote.actor = actor;
    }
    this.needsRender = true;
    if (room.phase === 'won' && this.state !== 'won') this.finish(true);
    else if ((room.phase === 'lost' || !own.alive) && this.state !== 'dead' && this.state !== 'won') this.finish(false);
  }

  private updateCoop(dt: number) {
    let danger = 0;
    for (const remote of this.remoteVisuals.values()) {
      remote.visual.update(remote.actor, dt, this.time);
      const actor = remote.actor;
      const d = Math.hypot(actor.x - this.camera.position.x, actor.z - this.camera.position.z);
      const sight = clearSight(this.map, actor.x, actor.z, this.camera.position.x, this.camera.position.z);
      if (actor.revealed && actor.alive) danger = Math.max(danger, Math.max(0, 1 - d / 15) * (sight ? 1 : 0.5));
      if (actor.alive && actor.moving) {
        remote.step += dt;
        if (remote.step > (actor.sprint ? 0.32 : 0.49)) {
          remote.step = 0;
          const pan = ((actor.x - this.camera.position.x) * Math.cos(this.yaw) - (actor.z - this.camera.position.z) * Math.sin(this.yaw)) / Math.max(d, 0.01);
          this.audio.creatureStep(d, pan, !sight, !!actor.revealed);
        }
      }
    }
    this.danger = danger;
    this.audio.updateDanger(danger);
    this.poseTime += dt;
    if (this.poseTime > 0.08) {
      this.poseTime = 0;
      this.networkSend?.({ t: 'pose', pose: this.getPose(), seq: ++this.poseSequence });
    }
  }

  private findInteraction(): Interactable | null {
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    let closest: Interactable | null = null;
    let best = Infinity;
    for (const item of this.interactables) {
      if (item.taken) continue;
      const delta = item.position.clone().sub(this.camera.position);
      const distance = delta.length();
      if (distance < 2.6 && distance < best && direction.dot(delta.normalize()) > 0.64 && clearSight(this.map, this.camera.position.x, this.camera.position.z, item.position.x, item.position.z)) {
        closest = item;
        best = distance;
      }
    }
    return closest;
  }

  private getHint(): Snapshot['hint'] {
    if (this.elapsed > this.hintUntil || this.hintUntil === 0) return null;
    let items = this.interactables.filter(item => item.type === 'fuse' && !item.taken);
    if (this.fuses === 3) items = this.interactables.filter(item => item.type === (this.powered ? 'exit' : 'panel'));
    const target = items.sort((a, b) => a.position.distanceTo(this.camera.position) - b.position.distanceTo(this.camera.position))[0];
    if (!target) return null;
    const vector = target.position.clone().setY(1.5);
    const direction = vector.clone().sub(this.camera.position);
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const behind = direction.dot(forward) < 0;
    vector.project(this.camera);
    const x = behind ? (direction.x * Math.cos(this.yaw) - direction.z * Math.sin(this.yaw) > 0 ? 0.92 : 0.08) : THREE.MathUtils.clamp(vector.x * 0.5 + 0.5, 0.08, 0.92);
    return { x, y: behind ? 0.5 : THREE.MathUtils.clamp(-vector.y * 0.5 + 0.5, 0.2, 0.8), distance: Math.round(direction.length()), behind };
  }

  private updateLights() {
    const camera = this.camera.position;
    const nearest = [...this.fixtures].sort((a, b) => a.position.distanceToSquared(camera) - b.position.distanceToSquared(camera));
    if (this.tubeMaterial) this.tubeMaterial.emissiveIntensity = 3.6 * this.lightLevel;
    this.ambientLights.forEach((light, i) => { light.intensity = (i ? .13 : .48) * (.18 + .82 * this.lightLevel); });
    this.lights.forEach((light, index) => {
      const fixture = nearest[index];
      light.visible = index < (this.settings.quality === 'low' ? 5 : this.settings.quality === 'medium' ? 8 : 10);
      if (!fixture || !light.visible) { light.intensity = 0; return; }
      light.position.copy(fixture.position);
      const flicker = fixture.flicker && (Math.sin(this.time * 17.3 + fixture.position.x) > 0.94 || Math.sin(this.time * 5.1) > 0.995) ? 0.18 : 1;
      const occlusion = clearSight(this.map, camera.x, camera.z, fixture.position.x, fixture.position.z) ? 1 : .2;
      light.intensity = fixture.strength * flicker * (this.powered ? 1.15 : 1) * this.lightLevel * occlusion;
    });
  }

  private frame = (timestamp: number) => {
    const dt = Math.min((timestamp - (this.lastTime || timestamp)) / 1000, 0.045);
    this.lastTime = timestamp;
    this.time += dt;
    let moving = false;
    if (this.state === 'menu') {
      this.camera.position.copy(this.menuPosition);
      this.camera.position.x += Math.sin(this.time * 0.14) * 0.075;
      this.camera.position.y += Math.sin(this.time * 0.23) * 0.014;
      this.camera.lookAt(this.menuLookAt.x + Math.sin(this.time * 0.1) * 0.14, this.menuLookAt.y, this.menuLookAt.z);
    } else if (this.state === 'playing') {
      if (!this.coop) this.elapsed += dt;
      moving = this.updatePlayer(dt);
    }
    if (this.coop && this.state !== 'menu') this.updateCoop(dt);
    this.updateFlashlight(dt);
    if (this.state === 'playing' || (this.coop && this.state === 'paused')) {
      const tension = this.tension.tick(this.elapsed, this.fuses, this.powered);
      this.lightLevel = tension.light;
      if (tension.event) this.audio.atmosphere(tension.event, tension.pan);
    }
    const animateMenu = this.state === 'menu' && this.menuAnimated && this.time - this.lastBackgroundRender > 1 / 24;
    if (animateMenu || this.state === 'playing' || this.needsRender || (this.coop && this.state === 'paused')) {
      if (this.state === 'menu') this.lastBackgroundRender = this.time;
      this.dust.position.y = Math.sin(this.time * 0.08) * 0.035;
      this.updateLights();
      this.film.uniforms.time.value = this.time;
      this.film.uniforms.danger.value = this.danger;
      this.composer.render();
      this.needsRender = false;
    }
    this.uiTime += dt;
    if (this.uiTime > 0.08 && this.state === 'playing') {
      this.uiTime = 0;
      this.callbacks.onUpdate({
        elapsed: this.elapsed,
        fuses: this.fuses,
        powered: this.powered,
        stamina: this.stamina,
        moving,
        flashlight: this.flashOn,
        danger: this.danger,
        interaction: this.target ? {
          type: this.target.type,
          label: this.target.type === 'note' ? 'ПОЛЕВАЯ ЗАПИСЬ ИССЛЕДОВАТЕЛЯ' : this.target.type === 'fuse' ? 'КЕРАМИЧЕСКИЙ ПРЕДОХРАНИТЕЛЬ' : this.target.type === 'panel' ? 'ЭЛЕКТРИЧЕСКИЙ ЩИТОК' : 'АВАРИЙНЫЙ ВЫХОД',
          action: this.target.type === 'note' ? 'Прочитать и настроить ориентир' : this.target.type === 'fuse' ? 'Забрать' : this.target.type === 'panel' ? this.powered ? 'Проверить' : 'Восстановить питание' : this.powered ? 'Открыть дверь' : 'Проверить дверь',
        } : null,
        hint: this.getHint(),
      });
    }
    this.animationId = requestAnimationFrame(this.frame);
  };

  dispose() {
    cancelAnimationFrame(this.animationId);
    this.resizeObserver.disconnect();
    this.mimicVisual.dispose();
    for (const remote of this.remoteVisuals.values()) remote.visual.dispose();
    this.remoteVisuals.clear(); this.viewArm?.dispose(); this.audio.dispose();
    this.composer.dispose(); this.renderer.dispose();
  }
}
