import type { MimicAIInfo } from './mind.ts';
export const PROTOCOL = 'backrooms-v2';
export const CAPACITY = 4;
export const PORT = 8787;
export type Pose = { x: number; z: number; yaw: number; pitch: number; flashlight: boolean; sprint: boolean; moving: boolean };
export type Actor = Pose & { id: string; name: string; skin: number; alive: boolean; revealed?: boolean };
export type LobbyPlayer = { id: string; name: string; skin: number; ready: boolean; alive: boolean };
export type RoomPhase = 'lobby' | 'playing' | 'won' | 'lost';
export type RoomView = {
  code: string;
  hostId: string;
  phase: RoomPhase;
  round: number;
  elapsed: number;
  players: LobbyPlayer[];
  actors: Actor[];
  fuses: boolean[];
  powered: boolean;
  capacity: number;
  ai?: MimicAIInfo;
};
export type Interaction = { kind: 'fuse' | 'panel' | 'exit'; index?: number };
export type ChatLine = { id: string; senderId: string; name: string; text: string; at: number; system?: boolean };
export type ClientMessage =
  | { t: 'create'; name: string }
  | { t: 'join'; name: string; code: string }
  | { t: 'rename'; name: string }
  | { t: 'ready'; ready: boolean }
  | { t: 'start' }
  | { t: 'lobby' }
  | { t: 'pose'; pose: Pose; seq: number }
  | { t: 'interact'; interaction: Interaction }
  | { t: 'say'; text: string }
  | { t: 'ping'; at: number };
export type ServerMessage =
  | { t: 'welcome'; id: string; room: RoomView; history?: ChatLine[] }
  | { t: 'state'; room: RoomView }
  | { t: 'chat'; line: ChatLine }
  | { t: 'error'; message: string }
  | { t: 'pong'; at: number };
