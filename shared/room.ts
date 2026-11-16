import { CELL, SPAWN, FUSE_CELLS, PANEL_CELL, EXIT_CELL, canStand, clearSight, createMap } from '../src/level.ts';
import { MimicBrain } from './mimic.ts';
import { CAPACITY } from './protocol.ts';
import type { Actor, ChatLine, Interaction, Pose, RoomPhase, RoomView } from './protocol.ts';

type Member = Actor & { ready: boolean; lastSeq: number; lastMoveAt: number; budget: number; chatAt: number };
export function cleanName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 18) : '';
}
export function cleanChat(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 160) : '';
}
export function validPose(pose: unknown): pose is Pose {
  if (!pose || typeof pose !== 'object') return false;
  const p = pose as Record<string, unknown>;
  return ['x', 'z', 'yaw', 'pitch'].every(k => typeof p[k] === 'number' && Number.isFinite(p[k]) && Math.abs(p[k] as number) < 10000)
    && ['flashlight', 'sprint', 'moving'].every(k => typeof p[k] === 'boolean');
}

/** The server owns objectives, damage, round state, membership and the Mimic. */
export class GameRoom {
  readonly members = new Map<string, Member>();
  readonly map = createMap();
  readonly code: string;
  hostId = '';
  phase: RoomPhase = 'lobby';
  round = 0;
  elapsed = 0;
  fuses = [false, false, false];
  powered = false;
  mimic?: MimicBrain;
  private serial = 0;
  private makeId: () => string;
  private now: () => number;
  private emit: (line: ChatLine) => void;

  constructor(code: string, emit: (line: ChatLine) => void, makeId: () => string, now = Date.now) {
    this.code = code;
    this.emit = emit;
    this.makeId = makeId;
    this.now = now;
  }

  add(id: string, nickname: string) {
    if (this.phase !== 'lobby') throw new Error('Экспедиция уже идёт. Дождитесь возвращения в лобби.');
    if (this.members.size >= CAPACITY) throw new Error('В комнате уже четыре игрока.');
    const name = cleanName(nickname);
    if (!name) throw new Error('Введите имя: буквы, цифры, пробел, дефис или подчёркивание.');
    if (!this.hostId) this.hostId = id;
    const used = new Set([...this.members.values()].map(p => p.skin));
    const skin = [0, 1, 2, 3].find(s => !used.has(s)) ?? 0;
    this.members.set(id, { id, name, skin, ready: id === this.hostId, alive: true, ...this.spawnPose(skin), lastSeq: -1, lastMoveAt: this.now(), budget: 0.5, chatAt: -Infinity });
    this.system(`${name} подключился к экспедиции.`);
  }

  remove(id: string) {
    const player = this.members.get(id);
    if (!player) return;
    this.members.delete(id);
    if (this.hostId === id) {
      this.hostId = this.members.keys().next().value ?? '';
      const host = this.members.get(this.hostId);
      if (host) { host.ready = true; this.system(`${host.name} теперь ведущий комнаты.`); }
    }
    this.system(`${player.name} потерял соединение.`);
    if (this.phase === 'playing' && ![...this.members.values()].some(p => p.alive)) this.phase = 'lost';
  }

  private spawnPose(index: number): Pose {
    return { x: SPAWN.x * CELL + (index % 2) * 0.8 - 0.4, z: SPAWN.z * CELL + Math.floor(index / 2) * 0.9,
      yaw: -2.65, pitch: 0, flashlight: true, moving: false, sprint: false };
  }

  ready(id: string, ready: boolean) {
    const player = this.member(id);
    if (this.phase !== 'lobby') throw new Error('Готовность меняется только в лобби.');
    player.ready = id === this.hostId || ready;
  }

  start(id: string) {
    if (id !== this.hostId) throw new Error('Начать экспедицию может только ведущий.');
    if (this.phase !== 'lobby') throw new Error('Экспедиция уже началась.');
    if (![...this.members.values()].every(p => p.ready)) throw new Error('Дождитесь готовности всех игроков.');
    this.phase = 'playing';
    this.round++;
    this.elapsed = 0;
    this.fuses = [false, false, false];
    this.powered = false;
    this.mimic = undefined;
    for (const member of this.members.values()) {
      Object.assign(member, this.spawnPose(member.skin), { alive: true, lastSeq: -1, lastMoveAt: this.now(), budget: 0.5 });
    }
    this.system('Запись началась. Предохранители общие. Не теряйте друг друга.');
  }

  lobby(id: string) {
    if (id !== this.hostId) throw new Error('Вернуть команду в лобби может только ведущий.');
    if (this.phase === 'playing') throw new Error('Экспедиция ещё идёт.');
    this.phase = 'lobby';
    this.mimic = undefined;
    for (const member of this.members.values()) { member.ready = member.id === this.hostId; member.alive = true; }
  }

  move(id: string, pose: unknown, seq: unknown): boolean {
    const player = this.member(id);
    if (this.phase !== 'playing' || !player.alive || !validPose(pose) || typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq <= player.lastSeq) return false;
    player.lastSeq = seq;
    const now = this.now();
    player.budget = Math.min(1.4, player.budget + Math.max(0, now - player.lastMoveAt) / 1000 * 4.35);
    player.lastMoveAt = now;
    const distance = Math.hypot(pose.x - player.x, pose.z - player.z);
    player.yaw = Math.atan2(Math.sin(pose.yaw), Math.cos(pose.yaw));
    player.pitch = Math.max(-1.42, Math.min(1.42, pose.pitch));
    player.flashlight = pose.flashlight;
    player.moving = pose.moving;
    player.sprint = pose.sprint;
    if (distance > player.budget + 0.01) return false;
    const steps = Math.max(1, Math.ceil(distance / 0.12));
    for (let i = 1; i <= steps; i++) {
      if (!canStand(this.map, player.x + (pose.x - player.x) * i / steps, player.z + (pose.z - player.z) * i / steps)) return false;
    }
    player.x = pose.x;
    player.z = pose.z;
    player.budget = Math.max(0, player.budget - distance);
    return true;
  }

  interact(id: string, action: Interaction) {
    const player = this.member(id);
    if (this.phase !== 'playing' || !player.alive) throw new Error('Сейчас нельзя взаимодействовать.');
    if (!action || !['fuse', 'panel', 'exit'].includes(action.kind)) throw new Error('Неизвестное действие.');
    const cell = action.kind === 'fuse' ? FUSE_CELLS[action.index ?? -1] : action.kind === 'panel' ? PANEL_CELL : EXIT_CELL;
    if (!cell) throw new Error('Предмет не найден.');
    const x = cell.x * CELL;
    const z = action.kind === 'fuse' ? cell.z * CELL : (cell.z - 0.5) * CELL + 0.1;
    if (Math.hypot(player.x - x, player.z - z) > 2.8 || !clearSight(this.map, player.x, player.z, x, z)) throw new Error('Подойдите ближе к предмету.');
    if (action.kind === 'fuse') {
      if (this.fuses[action.index!]) return; // Atomic/idempotent when two players press E together.
      this.fuses[action.index!] = true;
      this.system(`${player.name} нашёл предохранитель (${this.fuses.filter(Boolean).length}/3).`);
    } else if (action.kind === 'panel') {
      if (!this.fuses.every(Boolean)) throw new Error('Нужны все три предохранителя. Они общие для команды.');
      if (!this.powered) { this.powered = true; this.system('Питание восстановлено. Дверь рядом со щитком открыта!'); }
    } else {
      if (!this.powered) throw new Error('Выход заперт: сначала включите щиток.');
      this.phase = 'won';
      this.system(`${player.name} открыл выход. Экспедиция спасена.`);
    }
  }

  say(id: string, value: unknown) {
    const member = this.member(id);
    const text = cleanChat(value);
    if (!text) return;
    if (this.now() - member.chatAt < 900) throw new Error('Слишком частые сообщения.');
    member.chatAt = this.now();
    this.emit({ id: this.makeId(), senderId: id, name: member.name, text, at: this.now() });
    this.mimic?.hear(text);
  }

  tick(dt: number) {
    if (this.phase !== 'playing') return;
    dt = Math.min(dt, 0.1);
    this.elapsed += dt;
    const players = [...this.members.values()];
    if (!this.mimic && (this.elapsed > 18 || this.fuses.some(Boolean))) {
      this.mimic = new MimicBrain(this.map, players, this.makeId(), this.round * 983 + this.code.split('').reduce((a, c) => a + c.charCodeAt(0), 0));
    }
    if (!this.mimic) return;
    const event = this.mimic.tick(dt, players, this.fuses);
    if (event.speech) {
      this.emit({ id: this.makeId(), senderId: this.mimic.actor.id, name: this.mimic.actor.name, text: event.speech, at: this.now() });
    }
    if (event.revealedNow) this.system('Помехи в канале. Один из биосигналов не совпадает с записью.');
    if (event.victim) {
      const victim = this.members.get(event.victim);
      if (victim) { victim.alive = false; victim.moving = false; this.system(`Биосигнал ${victim.name} потерян.`); }
      if (![...this.members.values()].some(p => p.alive)) this.phase = 'lost';
    }
  }

  view(): RoomView {
    const players = [...this.members.values()];
    const actors: Actor[] = players.map(({ id, name, skin, alive, x, z, yaw, pitch, flashlight, sprint, moving }) => ({ id, name, skin, alive, x, z, yaw, pitch, flashlight, sprint, moving }));
    if (this.mimic && this.phase !== 'lobby') actors.push({ ...this.mimic.actor });
    return { code: this.code, hostId: this.hostId, phase: this.phase, round: this.round, elapsed: this.elapsed,
      players: players.map(({ id, name, skin, ready, alive }) => ({ id, name, skin, ready, alive })), actors,
      fuses: [...this.fuses], powered: this.powered, capacity: CAPACITY };
  }

  private member(id: string) {
    const member = this.members.get(id);
    if (!member) throw new Error('Игрок не состоит в комнате.');
    return member;
  }
  private system(text: string) {
    this.emit({ id: `${this.code}-${++this.serial}`, senderId: '', name: 'АРХИВ', text, at: this.now(), system: true });
  }
}
