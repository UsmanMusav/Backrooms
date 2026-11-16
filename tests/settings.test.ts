import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../src/settings.ts';

let stored = '';
Object.defineProperty(globalThis, 'localStorage', { value: {
  getItem: () => stored,
  setItem: (_key: string, value: string) => { stored = value; },
}, configurable: true });

test('settings use safe defaults if storage is empty or corrupt', () => {
  stored = '';
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  stored = '{broken';
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  stored = 'null';
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
});

test('settings sanitize stored values and clamp controls', () => {
  stored = JSON.stringify({ volume: 40, sensitivity: -5, quality: 'ultra', muted: 'yes', grain: false, headBob: false });
  const result = loadSettings();
  assert.equal(result.volume, 1);
  assert.equal(result.sensitivity, 0.1);
  assert.equal(result.quality, DEFAULT_SETTINGS.quality);
  assert.equal(result.muted, DEFAULT_SETTINGS.muted);
  assert.equal(result.grain, false);
  assert.equal(result.headBob, false);
});

test('settings round-trip locally', () => {
  const settings = { ...DEFAULT_SETTINGS, quality: 'low' as const, muted: true, volume: 0.2 };
  saveSettings(settings);
  assert.deepEqual(loadSettings(), settings);
});
