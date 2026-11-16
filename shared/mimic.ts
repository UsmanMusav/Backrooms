import { CELL, FUSE_CELLS, MAP_SIZE, canStand, cellAt, clearSight, findPath, seededRandom } from '../src/level.ts';
import type { Cell } from '../src/level.ts';
import type { Actor } from './protocol.ts';

export type MimicTick = { victim?: string; speech?: string; revealedNow?: boolean };
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** Server/offline simulation only. Trust scores, target IDs and paths are never sent to clients. */
export class MimicBrain {
  readonly actor: Actor;
  phase: 'masked' | 'revealed' = 'masked';
  trust = 0;
  age = 0;
  private targetId = '';
  private route: Cell[] = [];
  private planTimer = 0;
  private pauseTimer = 0;
  private nextPause = 4;
  private nextSpeech = 9;
  private mode: 'follow' | 'guide' | 'wait' = 'follow';
  private learnedSpeed = 2.1;
  private observed = new Map<string, { x: number; z: number }>();
  private lastPhrase = '';
  private random: () => number;
  private map: boolean[][];

  constructor(map: boolean[][], players: Actor[], id = 'offline-companion', seed = 7163) {
    this.map = map;
    this.random = seededRandom(seed);
    const target = players.find(p => p.alive);
    if (!target) throw new Error('Mimic needs a living target');
    this.targetId = target.id;
    const identity = players.find(p => p.id !== target.id) ?? { name: 'Саша', skin: 2 };
    const candidates: Cell[] = [];
    for (let z = 2; z < MAP_SIZE - 2; z++) {
      for (let x = 2; x < MAP_SIZE - 2; x++) {
        if (map[z][x]) continue;
        const d = distance({ x: x * CELL, z: z * CELL }, target);
        if (d > 13 && d < 24 && !clearSight(map, x * CELL, z * CELL, target.x, target.z)) {
          const path = findPath(map, cellAt(target.x, target.z), { x, z });
          if (path.length > 3 && path.length < 15) candidates.push({ x, z });
        }
      }
    }
    const spawn = candidates[Math.floor(this.random() * candidates.length)] ?? { x: 8, z: 6 };
    this.actor = { id, name: identity.name, skin: identity.skin, x: spawn.x * CELL, z: spawn.z * CELL,
      yaw: target.yaw, pitch: 0, flashlight: true, sprint: false, moving: false, alive: true };
  }

  hear(text: string) {
    // Only in-game public text. No microphone recording, voice cloning or private messages.
    const phrase = text.trim();
    if (phrase.length > 1 && phrase.length < 90) this.lastPhrase = phrase;
  }

  tick(dt: number, players: Actor[], takenFuses: boolean[]): MimicTick {
    const result: MimicTick = {};
    const alive = players.filter(p => p.alive);
    let target = alive.find(p => p.id === this.targetId);
    if (!target) {
      target = alive.sort((a, b) => distance(a, this.actor) - distance(b, this.actor))[0];
      this.targetId = target?.id ?? '';
      this.trust = 0;
      this.route = [];
      this.planTimer = 0;
    }
    if (!target) { this.actor.moving = false; return result; }
    dt = clamp(dt, 0, 0.1);
    this.age += dt;
    const d = distance(this.actor, target);
    const sight = clearSight(this.map, this.actor.x, this.actor.z, target.x, target.z);
    const previous = this.observed.get(target.id) ?? target;
    const vx = (target.x - previous.x) / Math.max(dt, 0.001);
    const vz = (target.z - previous.z) / Math.max(dt, 0.001);
    const speed = Math.hypot(vx, vz);
    if (speed > 0.2 && speed < 5) this.learnedSpeed += (speed - this.learnedSpeed) * dt * 0.7;
    this.observed.set(target.id, { x: target.x, z: target.z });

    if (this.phase === 'masked') {
      // This estimates approach/cooperation, not a human's actual beliefs.
      const looking = sight && d < 9 && (-(this.actor.x - target.x) * Math.sin(target.yaw) - (this.actor.z - target.z) * Math.cos(target.yaw)) / Math.max(d, 0.01) > 0.5;
      const cooperating = sight && d < 6 && target.moving && this.actor.moving;
      this.trust = clamp(this.trust + dt * ((sight && d < 3.6 ? 0.65 : 0) + (looking ? 0.28 : 0) + (cooperating ? 0.55 : 0) - (d > 12 ? 0.025 : 0)), 0, 40);
      if (this.age >= 30 && this.trust >= 18 && d < 3.8 && sight) {
        this.phase = 'revealed';
        this.actor.revealed = true;
        this.actor.name = 'MIMIC';
        this.actor.flashlight = false;
        this.route = [];
        this.planTimer = 0;
        result.revealedNow = true;
      }
    }

    this.planTimer -= dt;
    this.nextPause -= dt;
    this.pauseTimer -= dt;
    this.nextSpeech -= dt;
    if (this.phase === 'masked' && this.nextPause <= 0) {
      this.pauseTimer = 0.7 + this.random() * 1.6;
      this.nextPause = 5 + this.random() * 6;
      this.actor.flashlight = this.random() > 0.12 ? target.flashlight : !target.flashlight;
    }
    if (this.phase === 'masked' && this.nextSpeech < 0 && sight && d < 12) {
      const lines = ['я рядом', 'сюда, кажется проход', 'подожди меня', 'держимся вместе', 'проверю следующую комнату'];
      result.speech = this.lastPhrase && this.random() > 0.45 ? this.lastPhrase : lines[Math.floor(this.random() * lines.length)];
      this.nextSpeech = 18 + this.random() * 16;
    }

    if (this.planTimer <= 0) {
      this.planTimer = this.phase === 'revealed' ? 0.55 : 1.4 + this.random();
      let goal = cellAt(target.x, target.z);
      this.mode = 'follow';
      if (this.phase === 'masked' && sight && d < 6) {
        const objectives = FUSE_CELLS.filter((_cell, i) => !takenFuses[i]);
        const objective = objectives.sort((a, b) => distance({ x: a.x * CELL, z: a.z * CELL }, target) - distance({ x: b.x * CELL, z: b.z * CELL }, target))[0];
        const path = objective ? findPath(this.map, cellAt(target.x, target.z), objective) : [];
        if (path.length > 2 && this.random() > 0.35) {
          goal = path[Math.min(2, path.length - 1)];
          this.mode = 'guide';
        } else if (d < 3.1) this.mode = 'wait';
      }
      const anchor = this.route[0] ?? cellAt(this.actor.x, this.actor.z);
      const path = findPath(this.map, anchor, goal);
      this.route = distance(this.actor, { x: anchor.x * CELL, z: anchor.z * CELL }) < 0.08 ? path.slice(1) : path;
    }

    const before = { x: this.actor.x, z: this.actor.z };
    const next = this.route[0];
    const canMove = this.phase === 'revealed' || (this.pauseTimer <= 0 && this.mode !== 'wait' && (d > 2.5 || this.mode === 'guide'));
    if (next && canMove) {
      const dx = next.x * CELL - this.actor.x;
      const dz = next.z * CELL - this.actor.z;
      const length = Math.hypot(dx, dz);
      const gait = this.phase === 'revealed' ? 3.05 : clamp(this.learnedSpeed, 1.7, 3.6);
      const step = Math.min(length, gait * dt);
      if (length < 0.04) this.route.shift();
      else {
        const x = this.actor.x + dx / length * step;
        const z = this.actor.z + dz / length * step;
        if (canStand(this.map, x, this.actor.z, 0.18)) this.actor.x = x;
        if (canStand(this.map, this.actor.x, z, 0.18)) this.actor.z = z;
        this.actor.yaw = Math.atan2(-dx, -dz);
        if (length <= step + 0.001) this.route.shift();
      }
      this.actor.sprint = gait > 2.8;
    }
    this.actor.moving = distance(before, this.actor) > 0.0005;
    if (!this.actor.moving || (this.phase === 'masked' && this.pauseTimer > 0)) {
      this.actor.yaw = Math.atan2(target.x - this.actor.x, target.z - this.actor.z) + Math.PI + Math.sin(this.age * 0.7) * 0.18;
      this.actor.pitch = Math.sin(this.age * 0.55) * 0.12;
    }
    if (this.phase === 'revealed' && d < 0.82 && sight) result.victim = target.id;
    return result;
  }
}
