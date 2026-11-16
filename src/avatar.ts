import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { Actor } from '../shared/protocol';
import { createTorch, disposeProp, createExplorerGear } from './props';

let template: GLTF | undefined;
let textures: { albedo: THREE.Texture; normal: THREE.Texture; roughness: THREE.Texture; eyes: THREE.Texture };
let loading: Promise<void> | undefined;
/** One local GLB download, shared geometry/textures; each actor receives its own skeleton and mixer. */
export function loadExplorerAssets() {
  return loading ??= (async () => {
    const loader = new THREE.TextureLoader();
    const [model, albedo, normal, roughness, eyes] = await Promise.all([
      new GLTFLoader().loadAsync('/models/explorer.glb'), loader.loadAsync('/models/explorer-albedo.jpg'),
      loader.loadAsync('/models/explorer-normal.jpg'), loader.loadAsync('/models/explorer-roughness.png'), loader.loadAsync('/models/explorer-eyes.jpg'),
    ]);
    for (const texture of [albedo, normal, roughness, eyes]) { texture.flipY = false; texture.anisotropy = 4; }
    albedo.colorSpace = eyes.colorSpace = THREE.SRGBColorSpace;
    template = model; textures = { albedo, normal, roughness, eyes };
  })();
}
const SUITS = [0xfff7e4, 0xb6cbcd, 0xdec3a1, 0xc8d2b3];
function rig(withGear = true) {
  if (!template) throw new Error('Explorer model must be loaded before creating a player');
  const model = clone(template.scene);
  const materials: THREE.MeshStandardMaterial[] = [];
  const skeletons = new Set<THREE.Skeleton>();
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const eyes = /Eyes/i.test(object.name), eyebrows = /Eyebrows/i.test(object.name);
    const material = new THREE.MeshStandardMaterial({ color: eyebrows ? 0x292b22 : 0xffffff,
      map: eyebrows ? null : eyes ? textures.eyes : textures.albedo,
      normalMap: eyes || eyebrows ? null : textures.normal,
      normalScale: new THREE.Vector2(.45, .45), roughnessMap: eyes || eyebrows ? null : textures.roughness,
      roughness: eyes ? .25 : .98, metalness: eyes ? .12 : .02 });
    materials.push(material); object.material = material; object.castShadow = object.receiveShadow = true;
    if (object instanceof THREE.SkinnedMesh) { object.frustumCulled = false; skeletons.add(object.skeleton); }
  });
  if (withGear) {
    const { goggles, backpack } = createExplorerGear();
    model.add(goggles, backpack); goggles.position.set(0, 1.70, .091); backpack.position.set(0, 1.25, -.205);
    model.updateMatrixWorld(true);
    model.getObjectByName('Head')!.attach(goggles); model.getObjectByName('spine_03')!.attach(backpack);
  }
  model.rotation.y = Math.PI; // The source rig faces +Z; game forward is -Z.
  return { model, materials, skeletons };
}

/** Continuous skinned character, not separate boxes/capsules. Humans and masked Mimic are identical. */
export class ExplorerAvatar {
  readonly group = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  readonly actions = new Map<string, THREE.AnimationAction>();
  private materials: THREE.MeshStandardMaterial[];
  private skeletons: Set<THREE.Skeleton>;
  private head?: THREE.Bone;
  private torch = createTorch();
  private light = new THREE.SpotLight(0xffefcd, 7, 11, .42, .7, 1.8);
  private tag: THREE.Sprite;
  private name = '';
  private skin = -1;
  private revealed = false;
  private initialized = false;
  private active?: THREE.AnimationAction;
  private revealTime = 0;
  private dead = false;

  constructor() {
    const asset = rig(); this.model = asset.model; this.materials = asset.materials; this.skeletons = asset.skeletons;
    this.group.add(this.model); this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of template!.animations) {
      const action = this.mixer.clipAction(clip); this.actions.set(clip.name, action);
      if (['reveal', 'death', 'attack', 'interact'].includes(clip.name)) { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
    }
    this.model.traverse(o => { if (o instanceof THREE.Bone && o.name === 'Head') this.head = o; });
    // Calibrate the grasp to the library's left-handed torch pose, then let the skeleton animate it.
    this.play('torch', 0); this.mixer.update(.3); this.group.updateMatrixWorld(true);
    const hand = this.model.getObjectByName('hand_l')!;
    this.group.add(this.torch); this.torch.position.copy(hand.getWorldPosition(new THREE.Vector3())); this.torch.position.z -= .025;
    this.torch.scale.setScalar(.85); this.group.updateMatrixWorld(true); hand.attach(this.torch);
    this.light.position.set(-.23, 1.35, -.45);
    const aim = new THREE.Object3D(); aim.position.set(-.23, 1.31, -8); this.group.add(aim, this.light); this.light.target = aim;
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: true, depthWrite: false, opacity: .83 }));
    this.tag.position.y = 2.02; this.tag.scale.set(1.3, .18, 1); this.group.add(this.tag);
    this.play('torch', 0);
  }

  reset() {
    this.mixer.stopAllAction(); this.active = undefined; this.initialized = false; this.revealed = this.dead = false; this.revealTime = 0; this.skin = -1;
    if (this.head) this.head.scale.set(1, 1, 1);
    this.play('torch', 0); this.group.visible = false;
  }

  private play(name: string, duration = .22) {
    const next = this.actions.get(name)!;
    if (!next || this.active === next) return;
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    if (this.active && duration > 0) next.crossFadeFrom(this.active, duration, false);
    else this.active?.stop();
    this.active = next;
  }

  update(actor: Actor, dt: number, time: number, snap = false) {
    this.group.visible = true;
    const factor = snap || !this.initialized ? 1 : 1 - Math.exp(-dt * 14); this.initialized = true;
    this.group.position.x += (actor.x - this.group.position.x) * factor;
    this.group.position.z += (actor.z - this.group.position.z) * factor;
    this.group.rotation.y += Math.atan2(Math.sin(actor.yaw - this.group.rotation.y), Math.cos(actor.yaw - this.group.rotation.y)) * factor;
    const revealed = !!actor.revealed;
    if (revealed && !this.revealed) { this.revealTime = .48; this.play('reveal', .1); }
    if (!actor.alive && !this.dead) this.play('death', .13);
    this.dead = !actor.alive;
    this.revealTime = Math.max(0, this.revealTime - dt);
    if (actor.alive && this.revealTime === 0) this.play(actor.moving ? actor.sprint || revealed ? 'run' : 'walk' : revealed ? 'idle' : actor.flashlight ? 'torch' : 'idle');
    if (this.active && actor.moving) this.active.setEffectiveTimeScale(revealed ? 1.08 : actor.sprint ? 1 : .95);
    this.mixer.update(Math.max(0, dt));
    if (this.head) {
      this.head.rotation.x += -actor.pitch * .48;
      if (revealed) { this.head.rotation.z += -.34 + Math.sin(time * 7) * .07; this.head.scale.set(.87, 1.22, 1); }
      else this.head.scale.set(1, 1, 1);
    }
    if (this.name !== actor.name || this.skin !== actor.skin || revealed !== this.revealed) {
      this.name = actor.name; this.skin = actor.skin; this.revealed = revealed;
      for (const material of this.materials) { material.color.setHex(revealed ? 0x434d40 : SUITS[Math.abs(actor.skin) % SUITS.length]); material.roughness = revealed ? .78 : .98; }
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 72;
      const ctx = canvas.getContext('2d')!; ctx.font = '24px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = '#111b0d'; ctx.shadowBlur = 8; ctx.fillStyle = revealed ? '#d5ae88' : '#d5d7ba'; ctx.fillText(revealed ? 'M I M I C' : actor.name, 256, 36, 480);
      const material = this.tag.material as THREE.SpriteMaterial; material.map?.dispose(); material.map = new THREE.CanvasTexture(canvas); material.map.colorSpace = THREE.SRGBColorSpace; material.needsUpdate = true;
    }
    this.tag.visible = actor.alive; this.torch.visible = actor.flashlight && !revealed && actor.alive; this.light.visible = this.torch.visible;
  }

  dispose() {
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.model);
    this.skeletons.forEach(s => s.dispose()); this.materials.forEach(m => m.dispose());
    (this.tag.material as THREE.SpriteMaterial).map?.dispose(); this.tag.material.dispose();
    disposeProp(this.torch);
    for (const name of ['ProtectiveGoggles', 'FieldPack']) { const gear = this.model.getObjectByName(name); if (gear) disposeProp(gear); }
    this.light.dispose(); this.group.removeFromParent();
  }
}

/** First-person arm is cut from the same weighted, textured mesh, not assembled fingers. */
export function createViewArm() {
  const asset = rig(false); const root = new THREE.Group(); root.name = 'SkinnedViewArm'; root.add(asset.model);
  let body: THREE.SkinnedMesh | undefined;
  asset.model.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.name !== 'Explorer_Suit') { object.visible = false; return; }
    body = object as THREE.SkinnedMesh;
    const geometry = object.geometry.clone(), positions = geometry.attributes.position, index = geometry.index!;
    const triangles: number[] = [];
    for (let i = 0; i < index.count; i += 3) {
      const vertices = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      if (vertices.every(v => positions.getX(v) > .32 && positions.getY(v) > 1.05)) triangles.push(...vertices);
    }
    geometry.setIndex(triangles); object.geometry = geometry; object.castShadow = false;
  });
  const mixer = new THREE.AnimationMixer(asset.model); mixer.clipAction(template!.animations.find(c => c.name === 'torch')!).play(); mixer.update(.3); root.updateMatrixWorld(true);
  const hand = asset.model.getObjectByName('hand_l')!;
  const anchor = hand.getWorldPosition(new THREE.Vector3()); asset.model.position.sub(anchor).add(new THREE.Vector3(0, -.025, .045));
  return { root, mixer, dispose: () => { mixer.stopAllAction(); mixer.uncacheRoot(asset.model); body?.geometry.dispose(); asset.skeletons.forEach(s => s.dispose()); asset.materials.forEach(m => m.dispose()); } };
}
