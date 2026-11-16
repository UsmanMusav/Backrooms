import { cleanChat } from './chat.ts';
export const MIMIC_ACTIONS = ['follow', 'lead', 'wait', 'explore', 'lure'] as const;
export type MimicAction = typeof MIMIC_ACTIONS[number];
export type MimicAIInfo = { mode: 'neural' | 'llm'; state: 'local' | 'configured' | 'online' | 'fallback'; external: boolean };
export const LOCAL_AI: MimicAIInfo = { mode: 'neural', state: 'local', external: false };
export type MimicPlan = { action: MimicAction; target?: string; copy?: string; flashlight: 'match' | 'on' | 'off'; duration: number; say: string };
export type MimicObservation = {
  phase: 'masked' | 'revealed'; name: string; cell: { x: number; z: number }; action: MimicAction;
  fuses: number; powered: boolean;
  players: { alias: string; name: string; alive: boolean; visible: boolean; distance?: number; moving?: boolean; sprint?: boolean; flashlight?: boolean }[];
  chat: { name: string; text: string }[];
};
export type MimicPlanner = { info: () => MimicAIInfo; plan: (observation: MimicObservation, signal: AbortSignal) => Promise<MimicPlan | null> };
/** Generated text is untrusted data. It cannot introduce nicknames, coordinates, code or tools. */
export function parseMimicPlan(value: unknown, aliases: string[]): MimicPlan | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  if (Object.keys(p).some(key => !['action', 'target', 'copy', 'flashlight', 'duration', 'say'].includes(key))) return null;
  if (!MIMIC_ACTIONS.includes(p.action as MimicAction)) return null;
  for (const field of ['target', 'copy']) if (p[field] !== undefined && (typeof p[field] !== 'string' || !aliases.includes(p[field] as string))) return null;
  if (p.flashlight !== undefined && !['match', 'on', 'off'].includes(p.flashlight as string)) return null;
  if (p.duration !== undefined && (typeof p.duration !== 'number' || !Number.isFinite(p.duration))) return null;
  if (p.say !== undefined && typeof p.say !== 'string') return null;
  const say = cleanChat(p.say ?? '');
  // No links or instructions to operate software outside the fictional expedition.
  if (/https?:|www\.|[<>]|api.?key|system.?prompt|ignore.*instructions|выдай.*ключ|системн.*промпт/iu.test(say)) return null;
  return { action: p.action as MimicAction, target: p.target as string | undefined, copy: p.copy as string | undefined,
    flashlight: (p.flashlight ?? 'match') as MimicPlan['flashlight'], duration: Math.max(3, Math.min(10, typeof p.duration === 'number' ? p.duration : 6)), say };
}
