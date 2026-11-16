const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;
export function cleanName(value: unknown): string {
  return typeof value === 'string' ? [...value.normalize('NFKC').replace(INVISIBLE, '').replace(/[^\p{L}\p{N} _-]/gu, '').replace(/\s+/g, ' ').trim()].slice(0, 18).join('') : '';
}
export const nameKey = (value: string) => cleanName(value).toLocaleLowerCase('ru-RU');
export const reservedName = (name: string) => ['архив', 'mimic', 'система', 'system', 'сервер', 'server'].includes(nameKey(name));
export function cleanChat(value: unknown): string {
  return typeof value === 'string' ? [...value.normalize('NFKC').replace(INVISIBLE, '').trim()].slice(0, 160).join('') : '';
}
