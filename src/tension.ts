import { seededRandom } from './level.ts';
export type AtmosphereEvent = 'pipe' | 'drip' | 'radio' | 'echo' | 'electric';
export type TensionFrame = { light: number; event?: AtmosphereEvent; pan: number; surge: boolean };

/** Client-only presentation; objectives, human/AI positions and damage remain authoritative.
 * Schedule is seeded by room+round and driven by server elapsed time, not frame rate.
 * Catch-up after a stalled tab never replays a backlog of loud sounds. */
export class TensionDirector {
  private schedule: { at: number; kind: AtmosphereEvent; pan: number; duration: number }[] = [];
  private cursor = 0;
  private previous = -1;
  private fuses = 0;
  private powered = false;
  private surgeAt = -100;
  private surgeDuration = 0;
  reset(seed = 7813) {
    this.cursor = this.fuses = 0; this.previous = -1; this.powered = false; this.surgeAt = -100; this.surgeDuration = 0;
    const random = seededRandom(seed), kinds: AtmosphereEvent[] = ['pipe', 'drip', 'radio', 'echo', 'electric'];
    let at = 17 + random() * 7;
    this.schedule = Array.from({ length: 240 }, (_, index) => {
      const kind = index % 4 === 3 ? 'electric' : kinds[Math.floor(random() * 4)];
      const event = { at, kind, pan: (random() > .5 ? 1 : -1) * (.35 + random() * .5), duration: kind === 'electric' ? 2.5 + random() : 0 };
      at += 23 + random() * 19; return event;
    });
  }
  constructor(seed = 7813) { this.reset(seed); }
  tick(elapsed: number, fuses: number, powered: boolean): TensionFrame {
    if (elapsed < this.previous) this.reset();
    let event: AtmosphereEvent | undefined, pan = .4, surge = false;
    while (this.cursor < this.schedule.length && elapsed >= this.schedule[this.cursor].at) {
      const next = this.schedule[this.cursor++];
      if (elapsed - next.at < .6) {
        event = next.kind; pan = next.pan;
        if (event === 'electric' && !powered) { this.surgeAt = next.at; this.surgeDuration = next.duration; surge = true; }
      }
    }
    if (fuses > this.fuses && fuses === 2 && this.previous >= 0) { this.surgeAt = elapsed; this.surgeDuration = 3.3; event = 'electric'; surge = true; }
    if (powered && !this.powered) { this.surgeAt = elapsed; this.surgeDuration = .85; }
    this.previous = elapsed; this.fuses = fuses; this.powered = powered;
    const t = elapsed - this.surgeAt;
    let light = 1;
    if (t >= 0 && t < this.surgeDuration) {
      // A short relay warning, a gentle dip, then a smooth recovery; no high-frequency strobe.
      if (t < .26) light = .68 + .32 * Math.cos(t * 12);
      else if (t < this.surgeDuration - .65) light = .045;
      else { const rise = Math.max(0, (t - (this.surgeDuration - .65)) / .65); light = .045 + .955 * rise * rise; }
    }
    return { light, event, pan, surge };
  }
}

export const FIELD_NOTES = [
  { x: 8, z: 6, title: 'ЗАПИСЬ 01 / ЧУЖОЙ', text: 'Он повторял наши слова и носил тот же костюм. Знакомое имя — не доказательство. Не подпускайте его вплотную.' },
  { x: 4, z: 18, title: 'ЗАПИСЬ 02 / ТИШИНА', text: 'После раскрытия он слышит бег. Разорвите прямую видимость, спрячьте фонарь и замрите. Он пойдёт проверять последнее место, где вас заметил.' },
  { x: 21, z: 11, title: 'ЗАПИСЬ 03 / ВЫХОД', text: 'Три керамических предохранителя. Щиток и дверь остались у входа. Держите силы на обратный путь: после второго предохранителя свет может пропасть.' },
] as const;
