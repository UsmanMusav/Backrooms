import * as THREE from 'three';
import { CastMember } from './avatar';
import { CELL, clearSight, seededRandom } from './level';

export type StalkerEvent = { seen?: number; vanished?: number };

/**
 * The Watcher: a lightless, too-tall figure that sometimes stands at the far end of a corridor
 * behind the player. It never moves, never touches anyone and has no collision; it is gone the
 * moment it is stared at, lit or approached. Solo presentation only; never affects objectives.
 */
export class Stalker {
  readonly member = new CastMember('stalker', 'Stalker');
  private random = seededRandom(1991);
  private nextAt = 40;
  private visible = false;
  private noticed = false;
  private life = 0;
  private look = 0;
  private hidden = 0;
  private tilt = 0;
  appearances = 0;
  /** 0..1 tape-glitch pulse for the film pass. */
  glitch = 0;

  constructor(scene: THREE.Scene, private map: boolean[][]) {
    this.member.group.scale.set(.9, 1.17, .9);
    this.member.group.visible = false;
    scene.add(this.member.group);
  }

  reset(seed = 1991) {
    this.random = seededRandom(seed); this.nextAt = 38 + this.random() * 22; this.appearances = 0;
    this.hide(); this.glitch = 0;
  }
  get active() { return this.visible; }
  get position() { return this.member.group.position; }

  private hide() { this.visible = false; this.member.group.visible = false; this.noticed = false; this.look = this.life = this.hidden = this.tilt = 0; }

  /** Pick an open cell behind the player with a clear line of sight 11–24 m away. */
  private spawn(camera: THREE.Camera) {
    const forward = new THREE.Vector3(); camera.getWorldDirection(forward); forward.setY(0).normalize();
    const here = camera.position, candidates: THREE.Vector3[] = [];
    for (let z = 1; z < this.map.length - 1; z++) for (let x = 1; x < this.map.length - 1; x++) {
      if (this.map[z][x]) continue;
      const p = new THREE.Vector3(x * CELL, 0, z * CELL), d = Math.hypot(p.x - here.x, p.z - here.z);
      if (d < 11 || d > 24) continue;
      const toward = new THREE.Vector3(p.x - here.x, 0, p.z - here.z).normalize();
      if (toward.dot(forward) > -.35 || !clearSight(this.map, here.x, here.z, p.x, p.z)) continue;
      candidates.push(p);
    }
    if (!candidates.length) return false;
    const spot = candidates[Math.floor(this.random() * candidates.length)];
    this.member.group.position.copy(spot);
    this.member.group.visible = this.visible = true; this.noticed = false; this.life = this.look = this.hidden = 0;
    this.member.play('idle', 0, .25);
    return true;
  }

  update(dt: number, elapsed: number, camera: THREE.PerspectiveCamera, flashOn: boolean, enabled: boolean): StalkerEvent {
    this.glitch = Math.max(0, this.glitch - dt * 1.6);
    if (!enabled) { if (this.visible) this.hide(); return {}; }
    if (!this.visible) {
      if (elapsed >= this.nextAt && !this.spawn(camera)) this.nextAt = elapsed + 4;
      return {};
    }
    const event: StalkerEvent = {}, group = this.member.group, here = camera.position;
    const dx = group.position.x - here.x, dz = group.position.z - here.z, distance = Math.hypot(dx, dz);
    group.rotation.y = Math.atan2(-dx, -dz);
    const forward = new THREE.Vector3(); camera.getWorldDirection(forward);
    const toward = new THREE.Vector3(dx, 1.7 - here.y, dz).normalize();
    const angle = Math.acos(THREE.MathUtils.clamp(forward.dot(toward), -1, 1));
    const sight = clearSight(this.map, here.x, here.z, group.position.x, group.position.z);
    const inView = sight && angle < THREE.MathUtils.degToRad(camera.fov * .42);
    const right = new THREE.Vector3(-forward.z, 0, forward.x).normalize();
    const pan = THREE.MathUtils.clamp((dx * right.x + dz * right.z) / Math.max(distance, .01), -1, 1);
    this.life += dt;
    if (inView && !this.noticed) { this.noticed = true; event.seen = pan; this.appearances++; }
    if (this.noticed) {
      if (inView) this.look += dt; else this.hidden += dt;
      // The longer it is watched, the further the head lolls to one side.
      this.tilt = Math.min(.45, this.tilt + dt * .18);
    }
    const lit = flashOn && angle < .16 && distance < 17 && this.look > .35;
    const gone = this.look > 1.7 || lit || distance < 7.5;
    if (gone) {
      event.vanished = pan; this.glitch = .75; this.hide();
      this.nextAt = elapsed + 55 + this.random() * 50;
      return event;
    }
    if ((!this.noticed && this.life > 16) || this.hidden > 2.2) { this.hide(); this.nextAt = elapsed + 35 + this.random() * 30; return event; }
    this.member.update(dt);
    this.member.head?.rotateZ(this.tilt);
    return event;
  }

  dispose() { this.member.dispose(); }
}
