import { POLICY, DIALOGUE } from './ai/weights.ts';
import { best, infer, textFeatures } from './neural-core.ts';
import { MIMIC_ACTIONS } from './mind.ts';
import type { MimicAction } from './mind.ts';
export const INTENTS = ['greeting', 'location', 'wait', 'help', 'objective', 'suspicion', 'light', 'other'] as const;
export type ChatIntent = typeof INTENTS[number];
export function classifyChat(text: string): { intent: ChatIntent; confidence: number } {
  const probabilities = infer(DIALOGUE, textFeatures(text));
  const index = best(probabilities), confidence = probabilities[index];
  return { intent: confidence > .58 ? INTENTS[index] : 'other', confidence };
}
export function neuralAction(features: number[]): MimicAction { return MIMIC_ACTIONS[best(infer(POLICY, features))]; }
/** Limited offline dialogue: neural intent recognition + authored contextual phrases, NOT an LLM. */
export function localReply(intent: ChatIntent, action: MimicAction, context: { name: string; fuses: number; powered: boolean; nearEntry: boolean }, random: () => number) {
  const phrases: Record<ChatIntent, string[]> = {
    greeting: ['на связи. держимся рядом', 'привет, я уже в коридоре', 'слышу тебя. пойдем вместе'],
    location: [context.nearEntry ? 'я недалеко от входа, жду вас' : 'я в соседнем проходе. идите к свету', 'вижу проход дальше, подойди ко мне', 'рядом. не теряй меня из виду'],
    wait: ['хорошо, подожду здесь', 'стой на месте, я подойду', 'не спешим. я рядом'],
    help: ['не беги вслепую. иди ко мне', 'я рядом, держись света', 'слышу шаги тоже. давай вместе'],
    objective: [context.powered ? 'питание есть, возвращаемся к двери у входа' : context.fuses === 3 ? 'все три есть. нужен щиток у входа' : `нашли ${context.fuses} из трех. проверим соседние комнаты`, 'не расходись далеко. я проверю следующий проход'],
    suspicion: [`это ${context.name}. у меня тот же фонарь`, 'что? я просто ищу проход. держись рядом', 'не паникуй, тут рация с помехами'],
    light: ['с фонарем спокойнее. я подсвечу проход', 'лампы опять гаснут. не уходи далеко', 'держись ближе, здесь темно'],
    other: action === 'lead' || action === 'lure' ? ['сюда, кажется нашел проход', 'проверю эту сторону, идешь со мной?'] : action === 'wait' ? ['передохну секунду. подождите'] : ['я рядом', 'проверю следующую комнату', 'не теряйте связь'],
  };
  const choices = phrases[intent]; return choices[Math.floor(random() * choices.length)];
}
