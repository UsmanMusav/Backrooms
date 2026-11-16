export type Settings = {
  volume: number;
  sensitivity: number;
  grain: boolean;
  headBob: boolean;
  /** Analogue camcorder post-processing and viewfinder overlay. */
  camcorder: boolean;
  quality: 'low' | 'medium' | 'high';
  muted: boolean;
};
export const DEFAULT_SETTINGS: Settings = {
  volume: 0.65,
  sensitivity: 0.48,
  grain: true,
  headBob: true,
  camcorder: true,
  quality: 'high',
  muted: false,
};

export function loadSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem('backrooms-settings') || '{}');
    return {
      volume: typeof stored.volume === 'number' ? Math.max(0, Math.min(1, stored.volume)) : DEFAULT_SETTINGS.volume,
      sensitivity: typeof stored.sensitivity === 'number' ? Math.max(0.1, Math.min(1, stored.sensitivity)) : DEFAULT_SETTINGS.sensitivity,
      grain: typeof stored.grain === 'boolean' ? stored.grain : DEFAULT_SETTINGS.grain,
      headBob: typeof stored.headBob === 'boolean' ? stored.headBob : DEFAULT_SETTINGS.headBob,
      camcorder: typeof stored.camcorder === 'boolean' ? stored.camcorder : DEFAULT_SETTINGS.camcorder,
      quality: ['low', 'medium', 'high'].includes(stored.quality) ? stored.quality : DEFAULT_SETTINGS.quality,
      muted: typeof stored.muted === 'boolean' ? stored.muted : DEFAULT_SETTINGS.muted,
    };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(settings: Settings) {
  try { localStorage.setItem('backrooms-settings', JSON.stringify(settings)); } catch { /* Storage is optional. */ }
}
