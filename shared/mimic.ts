import { CELL, FUSE_CELLS, PANEL_CELL, EXIT_CELL, SPAWN, MAP_SIZE, canStand, cellAt, clearSight, findPath, seededRandom } from '../src/level.ts';
import type { Cell } from '../src/level.ts';
import type { Actor, ChatLine } from './protocol.ts';
import { classifyChat, localReply, neuralAction } from './neural-mind.ts';
import type { ChatIntent } from './neural-mind.ts';
import { cleanChat } from './chat.ts';
import type { MimicAction, MimicObservation, MimicPlan } from './mind.ts';

export type MimicTick = { victim?: string; speech?: string; revealedNow?: boolean };
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** Server/offline simulation only. Trust scores, target IDs and paths are never sent to clients. */
export class MimicBrain {
  readonly actor: Actor;
  phase: 'masked' | 'revealed' = 'masked';
  trust = 0;
  age = 0;
  searching = false;
  private memory = 0;
  private lastKnown?: Cell;
  private searchGoal?: Cell;
  private targetId = '';
  private route: Cell[] = [];
  private planTimer = 0;
  private pauseTimer = 0;
  private nextPause = 4;
  private nextSpeech = 9;
  private mode: MimicAction = 'follow';
  private directed?: { action: MimicAction; until: number; flashlight: MimicPlan['flashlight'] };
  private wanderGoal?: Cell;
  private lastCopy = -20;
  private heard?: { intent: ChatIntent; at: number; due: number; senderId: string };
  private lastHeard?: { intent: ChatIntent; at: number; senderId: string };
  private queuedSpeech?: { text: string; due: number };
  private lastSpokenAt = -20;
  private lastSpoken = '';
  private externalSpeech = false;
  private learnedSpeed = 2.1;
  private observed = new Map<string, { x: number; z: number }>();
  private random: () => number;
  private map: boolean[][];

  constructor(map: boolean[][], players: Actor[], id = 'offline-companion', seed = 7163, options: { copyLonePlayer?: boolean } = {}) {
    this.map = map;
    this.random = seededRandom(seed);
    const target = players.find(p => p.alive);
    if (!target) throw new Error('Mimic needs a living target');
    this.targetId = target.id;
    const identity = players.find(p => p.id !== target.id && p.alive) ?? (options.copyLonePlayer ? target : { name: 'Саша', skin: 2 });
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

  hear(text: string, senderId = '') {
    const phrase = cleanChat(text);
    if (!phrase) return;
    const { intent } = classifyChat(phrase);
    this.lastHeard = { intent, senderId, at: this.age };
    this.heard = { ...this.lastHeard, due: this.age + 1.1 + Math.min(1.8, phrase.length / 65) + this.random() * .6 };
  }

  useExternalSpeech(enabled: boolean) { this.externalSpeech = enabled; }
  queueSpeech(text: string) {
    const clean = cleanChat(text);
    if (clean && clean !== this.lastSpoken) this.queuedSpeech = { text: clean, due: this.age + .8 + Math.min(1.5, clean.length / 90) };
  }
  private copyIdentity(id: string, players: Actor[]) {
    const player = players.find(p => p.id === id && p.alive);
    if (!player || this.phase !== 'masked' || this.age - this.lastCopy < 12) return;
    if (players.some(p => p.alive && distance(p, this.actor) < 13 && clearSight(this.map, p.x, p.z, this.actor.x, this.actor.z))) return;
    this.actor.name = player.name; this.actor.skin = player.skin; this.lastCopy = this.age;
  }
  direct(plan: MimicPlan, players: Actor[], targetId?: string, copyId?: string) {
    if (this.phase !== 'masked') return;
    if (targetId && targetId !== this.targetId && players.some(p => p.id === targetId && p.alive)) {
      this.targetId = targetId; this.trust = 0; this.route = []; this.wanderGoal = undefined;
    }
    if (copyId) this.copyIdentity(copyId, players);
    this.directed = { action: plan.action, until: this.age + plan.duration, flashlight: plan.flashlight };
    this.planTimer = 0;
    this.queueSpeech(plan.say);
  }
  observe(players: Actor[], chat: ChatLine[], fuses: boolean[], powered: boolean): MimicObservation {
    return { phase: this.phase, name: this.actor.name, cell: cellAt(this.actor.x, this.actor.z), action: this.mode, fuses: fuses.filter(Boolean).length, powered,
      players: players.map((p, index) => {
        const d = distance(p, this.actor), visible = p.alive && d < 14 && clearSight(this.map, p.x, p.z, this.actor.x, this.actor.z);
        return { alias: `p${index}`, name: p.name, alive: p.alive, visible,
          ...(visible ? { distance: Math.round(d * 10) / 10, moving: p.moving, sprint: p.sprint, flashlight: p.flashlight } : {}) };
      }), chat: chat.filter(line => !line.system).slice(-10).map(({ name, text, senderId }) => {
        const index = players.findIndex(p => p.id === senderId);
        return { name, text, source: senderId === this.actor.id ? 'self' : 'player', ...(index >= 0 ? { alias: `p${index}` } : {}) };
      }) };
  }

  tick(dt: number, players: Actor[], takenFuses: boolean[], powered = false): MimicTick {
    const result: MimicTick = {};
    const alive = players.filter(p => p.alive);
    let target = alive.find(p => p.id === this.targetId);
    if (!target) {
      target = alive.sort((a, b) => distance(a, this.actor) - distance(b, this.actor))[0];
      this.targetId = target?.id ?? '';
      this.trust = 0;
      this.route = [];
      this.planTimer = 0; this.lastKnown = undefined; this.searchGoal = undefined; this.memory = 0;
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
        this.lastKnown = cellAt(target.x, target.z); this.memory = 3.8;
        result.revealedNow = true;
      }
    }

    if (this.phase === 'revealed') {
      // No omniscient wall tracking: a player can escape by breaking sight and keeping quiet.
      const sees = sight && d < 25 && (target.flashlight || target.moving || d < 8);
      const hears = target.moving && d < (target.sprint ? 16 : 5.5);
      if (sees || hears) {
        if (this.searching) { this.planTimer = 0; this.route = []; }
        this.lastKnown = cellAt(target.x, target.z); this.memory = 3.8; this.searchGoal = undefined;
      } else this.memory = Math.max(0, this.memory - dt);
      this.searching = this.memory <= 0;
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
    if (this.directed && this.age > this.directed.until) this.directed = undefined;
    if (this.phase === 'masked' && this.directed) {
      this.actor.flashlight = this.directed.flashlight === 'match' ? target.flashlight : this.directed.flashlight === 'on';
    }
    if (this.phase === 'masked' && this.age - this.lastSpokenAt > 5.5) {
      let speech = '';
      if (this.queuedSpeech && this.age >= this.queuedSpeech.due) { speech = this.queuedSpeech.text; this.queuedSpeech = undefined; }
      else if (!this.externalSpeech && ((this.heard && this.age >= this.heard.due) || (this.nextSpeech < 0 && sight && d < 14))) {
        const intent = this.heard?.intent ?? 'other';
        speech = localReply(intent, this.mode, { name: this.actor.name, fuses: takenFuses.filter(Boolean).length, powered, nearEntry: distance(this.actor, { x: SPAWN.x * CELL, z: SPAWN.z * CELL }) < 10 }, this.random);
      }
      if (speech && speech !== this.lastSpoken) {
        result.speech = speech; this.lastSpoken = speech; this.lastSpokenAt = this.age; this.heard = undefined; this.nextSpeech = 15 + this.random() * 13;
      } else if (speech) this.nextSpeech = 2;
    }

    if (this.planTimer <= 0) {
      this.planTimer = this.phase === 'revealed' ? this.searching ? 1.7 : .55 : 1.4 + this.random();
      let goal = this.phase === 'revealed' ? this.lastKnown ?? cellAt(this.actor.x, this.actor.z) : cellAt(target.x, target.z);
      if (this.phase === 'revealed' && this.searching) {
        if (!this.searchGoal || distance(this.actor, { x: this.searchGoal.x * CELL, z: this.searchGoal.z * CELL }) < .6) {
          const options: Cell[] = [];
          for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
            const cell = { x: goal.x + dx, z: goal.z + dz };
            if (this.map[cell.z]?.[cell.x] === false) options.push(cell);
          }
          this.searchGoal = options[Math.floor(this.random() * options.length)] ?? goal;
        }
        goal = this.searchGoal;
      }
      if (this.phase === 'masked') {
        const context = this.lastHeard, recent = !!context && this.age - context.at < 8;
        const action = this.directed?.action ?? neuralAction([
          Math.min(1, d / 24), sight ? 1 : 0, target.moving ? 1 : 0, target.sprint ? 1 : 0,
          takenFuses.filter(Boolean).length / 3, alive.filter(p => distance(p, this.actor) < 9).length / 4,
          this.trust / 40, Math.min(1, this.age / 60), recent ? 1 : 0, recent && context?.intent === 'suspicion' ? 1 : 0,
          recent && context?.intent === 'wait' ? 1 : 0, this.random(),
        ]);
        if (action !== this.mode) this.wanderGoal = undefined;
        this.mode = action;
        if (recent && context?.senderId && !sight && action !== 'wait') this.copyIdentity(context.senderId, alive);
        if (action === 'lead') {
          const objectives = FUSE_CELLS.filter((_cell, i) => !takenFuses[i]);
          const objective = objectives.sort((a, b) => distance({ x: a.x * CELL, z: a.z * CELL }, target) - distance({ x: b.x * CELL, z: b.z * CELL }, target))[0] ?? (powered ? EXIT_CELL : PANEL_CELL);
          const path = findPath(this.map, cellAt(target.x, target.z), objective);
          if (path.length > 2) goal = path[Math.min(2, path.length - 1)];
          else goal = objective;
        } else if (action === 'explore' || action === 'lure') {
          if (!this.wanderGoal || distance(this.actor, { x: this.wanderGoal.x * CELL, z: this.wanderGoal.z * CELL }) < .3) {
            const origin = cellAt(this.actor.x, this.actor.z), options: Cell[] = [];
            for (let z = -2; z <= 2; z++) for (let x = -2; x <= 2; x++) {
              const cell = { x: origin.x + x, z: origin.z + z };
              if (this.map[cell.z]?.[cell.x] !== false || (x === 0 && z === 0)) continue;
              const path = findPath(this.map, origin, cell);
              if (path.length > 1 && path.length < 6) options.push(cell);
            }
            if (action === 'lure') options.sort((a, b) => distance({ x: b.x * CELL, z: b.z * CELL }, target) - distance({ x: a.x * CELL, z: a.z * CELL }, target));
            this.wanderGoal = action === 'lure' ? options[0] : options[Math.floor(this.random() * options.length)];
          }
          goal = this.wanderGoal ?? goal;
        }
      }
      const anchor = this.route[0] ?? cellAt(this.actor.x, this.actor.z);
      const path = findPath(this.map, anchor, goal);
      this.route = distance(this.actor, { x: anchor.x * CELL, z: anchor.z * CELL }) < 0.08 ? path.slice(1) : path;
    }

    const before = { x: this.actor.x, z: this.actor.z };
    const next = this.route[0];
    const canMove = this.phase === 'revealed' || (this.pauseTimer <= 0 && this.mode !== 'wait' && (d > 2.5 || ['lead', 'explore', 'lure'].includes(this.mode)));
    if (next && canMove) {
      const dx = next.x * CELL - this.actor.x;
      const dz = next.z * CELL - this.actor.z;
      const length = Math.hypot(dx, dz);
      const gait = this.phase === 'revealed' ? this.searching ? 1.65 : 3.05 : clamp(this.learnedSpeed, 1.7, 3.6);
      const step = Math.min(length, gait * dt);
      if (length < 0.04) this.route.shift();
      else {
        const x = this.actor.x + dx / length * step;
        const z = this.actor.z + dz / length * step;
        if (canStand(this.map, x, this.actor.z, 0.18)) this.actor.x = x;
        if (canStand(this.map, this.actor.x, z, 0.18)) this.actor.z = z;
        const yaw = Math.atan2(-dx, -dz);
        this.actor.yaw += Math.atan2(Math.sin(yaw - this.actor.yaw), Math.cos(yaw - this.actor.yaw)) * (1 - Math.exp(-dt * 9));
        if (length <= step + 0.001) this.route.shift();
      }
      this.actor.sprint = gait > 2.8;
    }
    this.actor.moving = distance(before, this.actor) > 0.0005;
    if (!this.actor.moving) this.actor.sprint = false;
    if (!this.actor.moving || (this.phase === 'masked' && this.pauseTimer > 0)) {
      if (this.phase === 'revealed' && this.searching) this.actor.yaw += dt * .8;
      else {
        const look = this.phase === 'revealed' && this.lastKnown ? { x: this.lastKnown.x * CELL, z: this.lastKnown.z * CELL } : target;
        const yaw = Math.atan2(look.x - this.actor.x, look.z - this.actor.z) + Math.PI + Math.sin(this.age * .7) * .18;
        this.actor.yaw += Math.atan2(Math.sin(yaw - this.actor.yaw), Math.cos(yaw - this.actor.yaw)) * (1 - Math.exp(-dt * 5));
      }
      this.actor.pitch = Math.sin(this.age * 0.55) * 0.12;
    }
    if (this.phase === 'revealed' && d < 0.82 && sight) result.victim = target.id;
    return result;
  }
}
