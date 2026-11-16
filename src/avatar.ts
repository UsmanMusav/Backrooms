import * as THREE from 'three';
import type { Actor } from '../shared/protocol';

const SUITS = [0x9f875b, 0x6c7c78, 0x97745c, 0x77715c];
/** Humans and the disguised Mimic deliberately use the exact same rig and nameplate. */
export class ExplorerAvatar {
  readonly group = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private arms: THREE.Group[] = [];
  private legs: THREE.Group[] = [];
  private suit: THREE.MeshStandardMaterial;
  private visor: THREE.MeshStandardMaterial;
  private tag: THREE.Sprite;
  private torch: THREE.SpotLight;
  private name = '';
  private skin = -1;
  private revealed = false;
  private phase = 0;
  private initialized = false;

  constructor() {
    this.suit = new THREE.MeshStandardMaterial({ color: SUITS[0], roughness: 0.93 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2c322a, roughness: 0.94 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x383d31, roughness: 0.88 });
    this.visor = new THREE.MeshStandardMaterial({ color: 0x222c24, roughness: 0.28, metalness: 0.5 });
    const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Group, x: number, y: number, z: number) => {
      const object = new THREE.Mesh(geometry, material);
      object.position.set(x, y, z);
      object.castShadow = true;
      parent.add(object);
      return object;
    };
    mesh(new THREE.CapsuleGeometry(0.19, 0.34, 6, 12), this.suit, this.torso, 0, 1.16, 0);
    mesh(new THREE.BoxGeometry(0.30, 0.35, 0.1), leather, this.torso, 0, 1.18, 0.19); // old pack
    mesh(new THREE.BoxGeometry(0.30, 0.045, 0.3), dark, this.torso, 0, 0.92, 0);
    for (const side of [-1, 1]) mesh(new THREE.BoxGeometry(0.036, 0.4, 0.026), leather, this.torso, side * 0.11, 1.22, -0.157);
    mesh(new THREE.CapsuleGeometry(0.125, 0.10, 6, 14), this.suit, this.head, 0, 0, 0);
    mesh(new THREE.BoxGeometry(0.20, 0.078, 0.045), this.visor, this.head, 0, 0.013, -0.12);
    mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.075, 12), dark, this.head, 0, -0.065, -0.12).rotation.x = Math.PI / 2;
    this.head.position.y = 1.62;
    this.torso.add(this.head);
    this.group.add(this.torso);
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      mesh(new THREE.CapsuleGeometry(0.065, 0.22, 4, 10), this.suit, arm, 0, -0.14, 0);
      mesh(new THREE.CapsuleGeometry(0.05, 0.23, 4, 10), this.suit, arm, 0, -0.39, -0.015);
      mesh(new THREE.CapsuleGeometry(0.047, 0.055, 4, 8), dark, arm, 0, -0.55, -0.025);
      arm.position.set(side * 0.23, 1.41, 0);
      this.group.add(arm);
      this.arms.push(arm);
      const leg = new THREE.Group();
      mesh(new THREE.CapsuleGeometry(0.082, 0.29, 5, 10), this.suit, leg, 0, -0.19, 0);
      mesh(new THREE.CapsuleGeometry(0.066, 0.24, 5, 10), this.suit, leg, 0, -0.52, 0);
      mesh(new THREE.BoxGeometry(0.14, 0.15, 0.25), dark, leg, 0, -0.77, -0.035);
      leg.position.set(side * 0.105, 0.85, 0);
      this.group.add(leg);
      this.legs.push(leg);
    }
    this.torch = new THREE.SpotLight(0xffefc5, 9, 12, 0.42, 0.7, 1.5);
    this.torch.position.set(0.23, 1.12, -0.36);
    const target = new THREE.Object3D();
    target.position.set(0, 1.1, -7);
    this.group.add(target, this.torch);
    this.torch.target = target;
    mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.15, 10), leather, this.group, 0.23, 1.12, -0.29).rotation.x = Math.PI / 2;
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: true, depthWrite: false, opacity: 0.82 }));
    this.tag.position.y = 2.04;
    this.tag.scale.set(1.6, 0.22, 1);
    this.group.add(this.tag);
  }

  update(actor: Actor, dt: number, time: number, snap = false) {
    this.group.visible = actor.alive;
    if (!actor.alive) return;
    const factor = snap || !this.initialized ? 1 : 1 - Math.exp(-dt * 14);
    this.initialized = true;
    this.group.position.x += (actor.x - this.group.position.x) * factor;
    this.group.position.z += (actor.z - this.group.position.z) * factor;
    const angle = Math.atan2(Math.sin(actor.yaw - this.group.rotation.y), Math.cos(actor.yaw - this.group.rotation.y));
    this.group.rotation.y += angle * factor;
    const revealed = !!actor.revealed;
    if (this.name !== actor.name || this.skin !== actor.skin || revealed !== this.revealed) {
      this.name = actor.name;
      this.skin = actor.skin;
      this.revealed = revealed;
      this.suit.color.setHex(revealed ? 0x10160f : SUITS[actor.skin % SUITS.length]);
      this.visor.emissive.setHex(revealed ? 0xb0a774 : 0x000000);
      const canvas = document.createElement('canvas');
      canvas.width = 512; canvas.height = 72;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'rgba(13,22,13,0.68)'; ctx.fillRect(0, 0, 512, 72);
      ctx.fillStyle = revealed ? '#d5ae88' : '#d5d7ba';
      ctx.font = '24px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(revealed ? 'M I M I C' : actor.name, 256, 36, 460);
      const material = this.tag.material as THREE.SpriteMaterial;
      material.map?.dispose();
      material.map = new THREE.CanvasTexture(canvas);
      material.map.colorSpace = THREE.SRGBColorSpace;
      material.needsUpdate = true;
    }
    this.phase += dt * (actor.sprint ? 12 : 8.3);
    this.head.rotation.x = -actor.pitch * 0.6;
    this.head.rotation.z = revealed ? -0.4 + Math.sin(time * 8) * 0.08 : Math.sin(time * 0.8) * 0.012;
    this.head.scale.set(revealed ? 0.82 : 1, revealed ? 1.45 : 1, 1);
    this.torso.position.y = actor.moving ? Math.sin(this.phase * 2) * 0.013 : Math.sin(time * 1.6) * 0.004;
    this.torso.rotation.z = revealed ? 0.13 : 0;
    this.arms.forEach((arm, i) => {
      arm.scale.y = revealed ? 1.75 : 1;
      arm.rotation.x = actor.moving ? Math.sin(this.phase + i * Math.PI) * (revealed ? 0.9 : 0.38) : -0.1;
      arm.rotation.z = revealed ? (i ? 0.24 : -0.24) : 0;
    });
    this.legs.forEach((leg, i) => { leg.rotation.x = actor.moving ? Math.sin(this.phase + (i + 1) * Math.PI) * 0.43 : 0; });
    this.torch.visible = actor.flashlight && !revealed;
    this.tag.position.y = revealed ? 2.18 : 2.04;
  }

  dispose() {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.group.traverse(object => {
      if (object instanceof THREE.Mesh) { geometries.add(object.geometry); for (const m of Array.isArray(object.material) ? object.material : [object.material]) materials.add(m); }
    });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
    (this.tag.material as THREE.SpriteMaterial).map?.dispose();
    this.tag.material.dispose();
    this.torch.dispose();
    this.group.removeFromParent();
  }
}
