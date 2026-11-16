import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CELL, WALL_HEIGHT, MAP_SIZE, SPAWN, FUSE_CELLS, PANEL_CELL, EXIT_CELL, canStand, clearSight, createMap, seededRandom, surfaceVariant } from './level';
import type { Cell } from './level';
import { MimicBrain } from '../shared/mimic';
import type { Actor, ClientMessage, Pose, RoomView } from '../shared/protocol';
import { ExplorerAvatar, createViewArm } from './avatar';
import { createTorch, createFuse, createSwitchboard, createArchive, createOfficeChair, createCardboardBox, createExitDoor, createReturnGrille } from './props';
import { prismaticLens, paintedSteel } from './materials';
import { FirstPersonMotion } from './motion';
import { TensionDirector, FIELD_NOTES } from './tension';
import { enrichEnvironment } from './environment';
import { wallpaperTexture, carpetTexture, ceilingTexture, stainTexture, surfaceMaps, addMacroVariation, WALL_VARIANT_WEIGHTS, CARPET_VARIANT_WEIGHTS, CEILING_VARIANT_WEIGHTS } from './textures';
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
  /** Optical camcorder zoom (1 = wide). */
  zoom: number;
  zooming: boolean;
};
export const MIN_ZOOM = 1, MAX_ZOOM = 6;
type Interactable = { type: 'fuse' | 'panel' | 'exit' | 'note'; position: THREE.Vector3; object: THREE.Group; index: number; taken: boolean };
type LightFixture = { position: THREE.Vector3; strength: number; flicker: boolean };
type Callbacks = {
  onState: (state: GameState) => void;
  onUpdate: (snapshot: Snapshot) => void;
  onMessage: (text: string, title?: string) => void;
};

/**
 * Analogue camcorder look: lens barrel, chroma bleed, interlaced scanlines, rolling tracking
 * noise, head-switching distortion at the bottom edge and focus hunting while zooming.
 */
const FilmShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    grain: { value: 0.016 },
    danger: { value: 0 },
    camcorder: { value: 1 },
    focus: { value: 0 },
    resolution: { value: new THREE.Vector2(1920, 1080) },
  },
  vertexShader: `varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float grain;
    uniform float danger;
    uniform float camcorder;
    uniform float focus;
    uniform vec2 resolution;
    varying vec2 vUv;
    float random(vec2 p) { return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    vec3 sampleLens(vec2 uv, float shift) {
      vec3 c;
      c.r = texture2D(tDiffuse, uv + vec2(shift, 0.0)).r;
      c.g = texture2D(tDiffuse, uv).g;
      c.b = texture2D(tDiffuse, uv - vec2(shift, 0.0)).b;
      return c;
    }
    void main() {
      vec2 uv = vUv;
      vec2 p = (uv - 0.5) * 2.0;
      uv = 0.5 + (uv - 0.5) * (1.0 + (0.008 + camcorder * 0.014) * dot(p,p));
      float line = floor(uv.y * resolution.y * 0.5);
      // Tape wobble, a slow rolling tracking band and head-switch tearing near the bottom.
      float band = fract(time * 0.045 + sin(time * 0.31) * 0.08);
      float roll = smoothstep(0.9, 1.0, sin(time * 0.21) * 0.5 + 0.5);
      float inBand = smoothstep(0.03, 0.0, abs(uv.y - band)) * (0.08 + roll * 0.55 + danger * 1.4);
      float headSwitch = smoothstep(0.022, 0.0, uv.y);
      float jitter = (random(vec2(line, floor(time * 30.0))) - 0.5) * 0.0011;
      uv.x += camcorder * (jitter + inBand * (random(vec2(line, time)) - 0.5) * 0.02 + headSwitch * 0.008 * sin(time * 40.0 + uv.y * 300.0) + sin(uv.y * 9.0 + time * 1.3) * 0.0006);
      float shift = (0.00055 + danger * 0.003) * dot(p,p) + camcorder * 0.0011;
      vec3 color = sampleLens(uv, shift);
      if (focus > 0.001) {
        // Autofocus hunting while the zoom motor runs.
        vec2 r = focus * 0.006 * vec2(resolution.y / resolution.x, 1.0);
        vec3 blur = color;
        blur += sampleLens(uv + vec2(r.x, 0.0), shift); blur += sampleLens(uv - vec2(r.x, 0.0), shift);
        blur += sampleLens(uv + vec2(0.0, r.y), shift); blur += sampleLens(uv - vec2(0.0, r.y), shift);
        blur += sampleLens(uv + r * 0.7, shift); blur += sampleLens(uv - r * 0.7, shift);
        blur += sampleLens(uv + vec2(r.x, -r.y) * 0.7, shift); blur += sampleLens(uv + vec2(-r.x, r.y) * 0.7, shift);
        color = blur / 9.0;
      }
      if (camcorder > 0.0) {
        // Chroma has less bandwidth than luma on tape: smear colour horizontally.
        vec3 smear = texture2D(tDiffuse, uv - vec2(0.004, 0.0)).rgb;
        float luma = dot(color, vec3(0.299, 0.587, 0.114));
        vec3 chroma = mix(color - luma, smear - dot(smear, vec3(0.299, 0.587, 0.114)), 0.45 * camcorder);
        color = luma + chroma * 0.82;
        color = color * 0.94 + 0.025;
      }
      float luminance = dot(color, vec3(0.2126,0.7152,0.0722));
      color = mix(color, vec3(luminance), 0.12);
      color *= vec3(1.025, 1.012, 0.955);
      float vignette = 1.0 - smoothstep(0.25, 1.45, length(p * vec2(0.83, 0.92))) * (0.63 + camcorder * 0.12);
      color *= vignette;
      float noise = random(floor(uv * resolution) + fract(time) * 987.0) - 0.5;
      color += noise * (grain * (0.32 + min(luminance, 1.0) * 0.68) + danger * 0.06 + inBand * camcorder * 0.09 + headSwitch * camcorder * 0.05);
      color *= 0.994 + sin(uv.y * resolution.y * 1.7) * 0.006;
      color *= 1.0 - camcorder * 0.07 * step(0.5, fract(gl_FragCoord.y * 0.5));
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
  private tubeMaterials: THREE.MeshStandardMaterial[] = [];
  private zoom = 1;
  private zoomPreset = 2.5;
  private zoomFocus = 0;
  private touchZoom = false;
  private lastZoomSound = 0;
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

    this.flashlight = new THREE.SpotLight(0xfff2d5, 20, 25, 0.40, 0.62, 1.0);
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
    // Every wall face and floor/ceiling tile picks a deterministic texture variant, a
    // rotation/mirror, and a world-space macro tint, so surfaces no longer repeat exactly.
    const makeSet = (count: number, make: (variant: number) => THREE.CanvasTexture, depth: number, rough: number, color: number, normal: number, macro: [number, number, number]) =>
      Array.from({ length: count }, (_, variant) => {
        const map = make(variant);
        const material = new THREE.MeshStandardMaterial({ map, ...surfaceMaps(map, depth, rough), normalScale: new THREE.Vector2(normal, normal), roughness: 1, color });
        return addMacroVariation(material, ...macro);
      });
    const wallMaterials = makeSet(WALL_VARIANT_WEIGHTS.length, wallpaperTexture, 2.2, .91, 0xf3e9c3, .65, [.12, .09, 3.1]);
    const floorMaterials = makeSet(CARPET_VARIANT_WEIGHTS.length, carpetTexture, 3, .98, 0xc3bc9b, .8, [.17, .13, 7.7]);
    const ceilingMaterials = makeSet(CEILING_VARIANT_WEIGHTS.length, ceilingTexture, 1.6, .96, 0xd4d5bf, 1, [.1, .1, 1.3]);
    const transformUv = (geometry: THREE.BufferGeometry, turn: number, mirror: boolean) => {
      const uv = geometry.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) {
        let u = uv.getX(i) - .5, v = uv.getY(i) - .5;
        for (let k = 0; k < turn; k++) [u, v] = [-v, u];
        uv.setXY(i, (mirror ? -u : u) + .5, v + .5);
      }
    };
    const floorTiles: THREE.BufferGeometry[][] = floorMaterials.map(() => []), ceilingTiles: THREE.BufferGeometry[][] = ceilingMaterials.map(() => []);
    for (let z = 0; z < MAP_SIZE; z++) for (let x = 0; x < MAP_SIZE; x++) {
      if (this.map[z][x]) continue;
      const floorPick = surfaceVariant(x, z, 0, CARPET_VARIANT_WEIGHTS, 11), ceilingPick = surfaceVariant(x, z, 1, CEILING_VARIANT_WEIGHTS, 23);
      const floorTile = new THREE.PlaneGeometry(CELL, CELL); transformUv(floorTile, floorPick.turn, floorPick.mirror);
      floorTile.rotateX(-Math.PI / 2).translate(x * CELL, 0, z * CELL); floorTiles[floorPick.variant].push(floorTile);
      const ceilingTile = new THREE.PlaneGeometry(CELL, CELL); transformUv(ceilingTile, ceilingPick.turn, false);
      ceilingTile.rotateX(Math.PI / 2).translate(x * CELL, WALL_HEIGHT, z * CELL); ceilingTiles[ceilingPick.variant].push(ceilingTile);
    }
    const addSurfaces = (buckets: THREE.BufferGeometry[][], materials: THREE.Material[], name: string) => buckets.forEach((geometries, variant) => {
      if (!geometries.length) return;
      const mesh = new THREE.Mesh(mergeGeometries(geometries), materials[variant]); mesh.name = `${name}-${variant}`; mesh.receiveShadow = true;
      this.scene.add(mesh); geometries.forEach(g => g.dispose());
    });
    addSurfaces(floorTiles, floorMaterials, 'Floor');
    addSurfaces(ceilingTiles, ceilingMaterials, 'Ceiling');

    const wallFaces: THREE.BufferGeometry[][] = wallMaterials.map(() => []), shadowFaces: THREE.BufferGeometry[] = [];
    const trims: THREE.BufferGeometry[] = [];
    const crowns: THREE.BufferGeometry[] = [];
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let z = 1; z < MAP_SIZE - 1; z++) {
      for (let x = 1; x < MAP_SIZE - 1; x++) {
        if (!this.map[z][x]) continue;
        directions.forEach(([dx, dz], face) => {
          if (this.map[z + dz]?.[x + dx] !== false) return;
          const pick = surfaceVariant(x, z, face, WALL_VARIANT_WEIGHTS, 5), angle = Math.atan2(dx, dz);
          const panel = new THREE.PlaneGeometry(CELL, WALL_HEIGHT); transformUv(panel, 0, pick.mirror);
          panel.rotateY(angle).translate(x * CELL + dx * CELL / 2, WALL_HEIGHT / 2, z * CELL + dz * CELL / 2); wallFaces[pick.variant].push(panel);
          // Inward-facing twin used only by the flashlight shadow map (like the back of a solid block).
          shadowFaces.push(new THREE.PlaneGeometry(CELL + .04, WALL_HEIGHT).rotateY(angle + Math.PI).translate(x * CELL + dx * (CELL / 2 - .02), WALL_HEIGHT / 2, z * CELL + dz * (CELL / 2 - .02)));
          const tx = x * CELL + dx * (CELL / 2 + 0.016);
          const tz = z * CELL + dz * (CELL / 2 + 0.016);
          trims.push(new THREE.BoxGeometry(dx ? 0.035 : CELL, 0.13, dz ? 0.035 : CELL).translate(tx, 0.065, tz));
          crowns.push(new THREE.BoxGeometry(dx ? 0.035 : CELL, 0.042, dz ? 0.035 : CELL).translate(tx, WALL_HEIGHT - 0.021, tz));
        });
      }
    }
    addSurfaces(wallFaces, wallMaterials, 'Wallpaper');
    const shadowMesh = new THREE.Mesh(mergeGeometries(shadowFaces), wallMaterials[0]);
    shadowMesh.name = 'WallShadowCaster'; shadowMesh.castShadow = true; this.scene.add(shadowMesh); shadowFaces.forEach(g => g.dispose());
    const baseboard = new THREE.Mesh(mergeGeometries(trims), new THREE.MeshStandardMaterial({ color: 0x504931, roughness: 0.88 }));
    baseboard.receiveShadow = true;
    this.scene.add(baseboard);
    this.scene.add(new THREE.Mesh(mergeGeometries(crowns), new THREE.MeshStandardMaterial({ color: 0x858269, roughness: 1 })));
    [...trims, ...crowns].forEach(geometry => geometry.dispose());

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
    // Surface-mounted 2-tube troffers: steel housing, end caps, prismatic acrylic lens.
    const housings: THREE.BufferGeometry[] = [], lenses: THREE.BufferGeometry[][] = [[], []];
    const random = seededRandom(73);
    fixtureCells.forEach((cell, index) => {
      const x = cell.x * CELL;
      const z = cell.z * CELL;
      const horizontal = index % 3 === 0;
      const w = horizontal ? 1.22 : 0.6;
      const d = horizontal ? 0.6 : 1.22;
      const y = WALL_HEIGHT - .022;
      housings.push(new THREE.BoxGeometry(w + .05, .044, .028).translate(x, y, z - d / 2 - .011), new THREE.BoxGeometry(w + .05, .044, .028).translate(x, y, z + d / 2 + .011),
        new THREE.BoxGeometry(.028, .044, d).translate(x - w / 2 - .011, y, z), new THREE.BoxGeometry(.028, .044, d).translate(x + w / 2 + .011, y, z),
        new THREE.BoxGeometry(horizontal ? .04 : w, .012, horizontal ? d : .04).translate(x + (horizontal ? w / 2 - .02 : 0), WALL_HEIGHT - .036, z + (horizontal ? 0 : d / 2 - .02)));
      lenses[horizontal ? 0 : 1].push(new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2).translate(x, WALL_HEIGHT - .03, z));
      this.fixtures.push({ position: new THREE.Vector3(x, WALL_HEIGHT - 0.23, z), strength: 14 + random() * 6, flicker: index % 9 === 4 });
    });
    const housing = new THREE.Mesh(mergeGeometries(housings), paintedSteel('#cfccb6', 70, .15)); housing.name = 'TrofferHousings'; this.scene.add(housing);
    housings.forEach(g => g.dispose());
    lenses.forEach((geometries, i) => {
      if (!geometries.length) return;
      const lens = prismaticLens(i === 0);
      const material = new THREE.MeshStandardMaterial({ color: 0xf4f8de, map: lens, emissive: 0xf1ffce, emissiveMap: lens, emissiveIntensity: 2.3, roughness: .4 });
      material.userData.baseEmissive = 2.3; this.tubeMaterials.push(material);
      const mesh = new THREE.Mesh(mergeGeometries(geometries), material); mesh.name = 'TrofferLenses'; this.scene.add(mesh); geometries.forEach(g => g.dispose());
    });
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
    const grille = createReturnGrille(1);
    for (const [x, z] of [[3, 5], [8, 8], [12, 3], [5, 18], [21, 10], [15, 20]]) {
      const vent = grille.clone(); vent.position.set(x * CELL, WALL_HEIGHT - 0.012, z * CELL); vent.rotation.y = (x + z) % 2 ? Math.PI / 2 : 0;
      this.scene.add(vent);
    }
    // Discarded cardboard and a fallen office chair make the rooms feel abandoned.
    for (const [x, z] of [[7.55, 5.4], [4.6, 10.1], [12, 11.9], [18.6, 9.6], [8, 23.4]]) {
      this.addBox(x * CELL, z * CELL, 0.62, 0.5, 0.54);
      if (x > 7) this.addBox(x * CELL + 0.48, z * CELL + 0.1, 0.42, 0.33, 0.42, true);
    }
    const chair = createOfficeChair(1);
    chair.rotation.set(0, 0.8, Math.PI / 2 - .06, 'YXZ');
    chair.position.set(8.2 * CELL, 0.33, 10.9 * CELL);
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

  private boxSeed = 1;
  private addBox(x: number, z: number, width: number, height: number, depth: number, open = false) {
    const box = createCardboardBox(width, height, depth, this.boxSeed++, open);
    box.position.set(x, 0, z); box.rotation.y = (this.boxSeed % 5 - 2) * .035;
    this.scene.add(box);
    this.obstacles.push({ x, z, w: width / 2 + 0.19, d: depth / 2 + 0.19 });
    return box;
  }

  private buildObjectives() {
    FUSE_CELLS.forEach((cell, index) => {
      const position = new THREE.Vector3(cell.x * CELL, .765, cell.z * CELL);
      this.addBox(position.x, position.z, .8, .62, .65);
      const group = createFuse(index); group.position.copy(position); this.scene.add(group);
      this.interactables.push({ type: 'fuse', position, object: group, index, taken: false });
    });
    const switchboard = createSwitchboard(WALL_HEIGHT - 1.36 - .47), panel = switchboard.group;
    this.panelIndicator = switchboard.indicator; this.panelLamps = switchboard.lamps; this.panelLever = switchboard.lever;
    panel.position.set(PANEL_CELL.x * CELL, 1.36, (PANEL_CELL.z - .5) * CELL + .1);
    this.scene.add(panel);
    this.interactables.push({ type: 'panel', position: panel.position.clone(), object: panel, index: -1, taken: false });
    FIELD_NOTES.forEach((note, index) => {
      const position = new THREE.Vector3(note.x * CELL, .51, note.z * CELL);
      this.addBox(position.x, position.z, .45, .49, .48);
      const group = createArchive(index, note.title, note.text); group.position.copy(position); group.rotation.y = index * .6 + .2; this.scene.add(group);
      this.interactables.push({ type: 'note', position, object: group, index, taken: false });
    });
    const { group: exit, sign } = createExitDoor();
    this.exitSign = sign;
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
    if (this.exitSign) (this.exitSign.material as THREE.MeshBasicMaterial).color.setHex(this.powered ? 0xffffff : 0x6f8070);
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
      if (event.code === 'KeyC') this.zoomFocus = Math.max(this.zoomFocus, .5);
      if (event.code === 'Escape' || event.code === 'KeyP') this.pause();
    });
    window.addEventListener('keyup', event => this.keys.delete(event.code));
    // Hold C and roll the wheel for optical zoom; the wheel alone never scrolls the page in-game.
    window.addEventListener('wheel', event => {
      if (this.state !== 'playing' || this.chatFocused || !this.zoomHeld()) return;
      event.preventDefault();
      this.adjustZoom(event.deltaY);
    }, { passive: false });
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
    // Sensitivity follows the field of view so a zoomed image stays controllable.
    const sensitivity = (0.0007 + this.settings.sensitivity * 0.003) / this.zoom;
    this.motion.look(-dx * sensitivity, -dy * sensitivity);
    this.yaw -= dx * sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * sensitivity, -1.42, 1.42);
  }

  setVirtualMovement(x: number, y: number) { this.virtualMovement.set(x, y); }
  /** Touch devices toggle zoom mode; pinching is not required. */
  setTouchZoom(active: boolean) { this.touchZoom = active; if (active) this.zoomFocus = Math.max(this.zoomFocus, .5); }
  setZoomPreset(value: number) { this.zoomPreset = THREE.MathUtils.clamp(value, 1.25, MAX_ZOOM); this.zoomFocus = Math.max(this.zoomFocus, .5); }
  private zoomHeld() { return this.state === 'playing' && !this.chatFocused && (this.keys.has('KeyC') || this.touchZoom); }
  adjustZoom(deltaY: number) {
    const step = THREE.MathUtils.clamp(-deltaY, -240, 240) * .0018;
    const next = THREE.MathUtils.clamp(this.zoomPreset * Math.exp(step), 1.25, MAX_ZOOM);
    if (Math.abs(next - this.zoomPreset) < 1e-4) return;
    this.zoomPreset = next; this.zoomFocus = Math.min(1, this.zoomFocus + .35);
    if (this.time - this.lastZoomSound > .09) { this.lastZoomSound = this.time; this.audio.zoomMotor(); }
  }
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
    this.zoom = 1; this.zoomFocus = 0; this.touchZoom = false;
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
    this.touchZoom = false;
    if (state !== 'playing' && state !== 'paused') { this.zoom = 1; this.zoomFocus = 0; }
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
    this.film.uniforms.camcorder.value = settings.camcorder ? 1 : 0;
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
    const targetZoom = this.zoomHeld() ? this.zoomPreset : 1;
    const previousZoom = this.zoom;
    this.zoom = THREE.MathUtils.damp(this.zoom, targetZoom, 7.5, dt);
    if (Math.abs(this.zoom - targetZoom) < .002) this.zoom = targetZoom;
    this.zoomFocus = Math.max(0, this.zoomFocus - dt * 1.6) + Math.min(.6, Math.abs(this.zoom - previousZoom) * 2.5);
    this.zoomFocus = Math.min(1, this.zoomFocus);
    this.camera.fov = this.zoom === 1 ? this.motionPose.fov : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.motionPose.fov) / 2) / this.zoom));
    this.camera.updateProjectionMatrix();
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
    this.flashlight.intensity = (this.powered ? 17.5 : 20) * (this.danger > .6 ? .91 + Math.sin(this.time * 4) * .09 : 1);
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
    for (const material of this.tubeMaterials) material.emissiveIntensity = material.userData.baseEmissive * this.lightLevel;
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
      this.film.uniforms.focus.value = this.state === 'playing' || this.state === 'paused' ? this.zoomFocus : 0;
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
        zoom: this.zoom,
        zooming: this.zoomHeld(),
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
