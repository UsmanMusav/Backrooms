import { test, expect } from '@playwright/test';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index';
import { PROTOCOL } from '../shared/protocol';
import type { ServerMessage } from '../shared/protocol';
import type { MimicObservation } from '../shared/mind';

// This is a mock model, not a claim to have run an external language model.
test('visible profile, chat history, Enter typing isolation, impersonated neural reply and honest LLM fallback', async ({ page }) => {
  test.setTimeout(180_000);
  const observations: MimicObservation[] = [];
  let fail = false;
  const server = createGameServer({ planner: {
    info: () => ({ mode: 'llm', state: observations.length ? fail ? 'fallback' : 'online' : 'configured', external: true }),
    plan: async observation => { observations.push(observation); return fail ? null : { action: 'wait', copy: 'p1', target: 'p0', flashlight: 'off', duration: 10, say: 'я у поворота. подожди меня' }; },
  } });
  const port = await server.listen(0, '127.0.0.1'), host = new WebSocket(`ws://127.0.0.1:${port}/ws`, PROTOCOL), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await once(host, 'open');
    const welcome = new Promise<Extract<ServerMessage, { t: 'welcome' }>>(resolve => host.on('message', data => {
      const message = JSON.parse(String(data)) as ServerMessage; if (message.t === 'welcome') resolve(message);
    }));
    host.send(JSON.stringify({ t: 'create', name: 'Олег' })); const initial = await welcome, room = server.rooms.get(initial.room.code)!;
    room.say(initial.id, 'Проверка связи до входа');
    await page.addInitScript(() => localStorage.setItem('backrooms-settings', JSON.stringify({ quality: 'low', muted: true, grain: false })));
    await page.goto('/'); await expect(page.locator('#boot')).toHaveCount(0);
    await page.locator('#coop-button').click(); await page.locator('#join-tab').click();
    await page.locator('#nickname-input').fill('Ирина'); await page.locator('#server-input').fill(`http://127.0.0.1:${port}`);
    await page.locator('#room-code-input').fill(initial.room.code); await page.locator('#connect-submit').click();
    await expect(page.locator('#lobby-chat-lines')).toContainText('Проверка связи до входа');
    await expect(page.locator('#lobby-ai-info')).toContainText('внешнему провайдеру');
    await page.locator('#rename-input').fill('Олег'); await page.locator('#rename-submit').click();
    await expect(page.locator('#lobby-status')).toContainText('занят');
    await page.locator('#rename-input').fill('Ника'); await page.locator('#rename-submit').click();
    await expect(page.locator('#lobby-roster')).toContainText('Ника');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('backrooms-name'))).toBe('Ника');
    await page.locator('#lobby-start').click(); await expect.poll(() => [...room.members.values()].every(p => p.ready)).toBe(true);
    host.send(JSON.stringify({ t: 'start' })); await expect(page.locator('body')).toHaveAttribute('data-state', 'playing');
    const own = [...room.members.values()].find(p => p.id !== initial.id)!;
    const before = { x: own.x, z: own.z, flashlight: own.flashlight };
    await page.keyboard.press('Enter'); await expect(page.locator('#radio-input')).toBeFocused();
    await page.locator('#radio-input').pressSequentially('wasdf', { delay: 70 });
    await expect(page.locator('#chat-counter')).toHaveText('5 / 160');
    expect(Math.hypot(own.x - before.x, own.z - before.z)).toBeLessThan(.01); expect(own.flashlight).toBe(before.flashlight);
    await expect(page.locator('body')).toHaveAttribute('data-state', 'playing');
    await page.locator('#radio-input').fill('<img src=x onerror=alert(1)> ты где?'); await page.locator('#radio-input').press('Enter');
    await expect(page.locator('#radio-input')).toBeHidden(); await expect(page.locator('#radio-lines')).toContainText('<img src=x');
    await expect(page.locator('#radio-lines img')).toHaveCount(0);
    room.fuses[0] = true; room.tick(.05);
    await expect.poll(() => observations.length).toBeGreaterThan(0);
    await expect(page.locator('#radio-lines')).toContainText('я у поворота. подожди меня');
    await expect(page.locator('#radio-lines .chat-line').filter({ hasText: 'я у поворота. подожди меня' }).locator('span')).toHaveText('Ника');
    expect(room.mimic!.actor.id).not.toBe(own.id); expect(room.mimic!.actor.name).toBe('Ника');
    await page.keyboard.press('Enter'); await expect(page.locator('#chat-ai-status')).toContainText('LLM отвечает');
    await page.locator('#radio-input').press('Escape'); await expect(page.locator('#radio-toggle')).toHaveAttribute('aria-expanded', 'false');
    // Expedite only this fixture's authoritative clock; there is no browser debug API.
    fail = true; for (let i = 0; i < 170; i++) room.tick(.05);
    await expect.poll(() => room.view().ai!.state).toBe('fallback');
    await page.keyboard.press('Enter'); await expect(page.locator('#chat-ai-status')).toContainText('локальная нейросеть');
    await expect(page.locator('body')).toHaveAttribute('data-state', 'playing');
    expect(errors).toEqual([]);
  } finally { host.terminate(); await server.close(); }
});

test('mobile lobby profile and tap-to-open chat fit without horizontal overflow', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    await page.addInitScript(() => localStorage.setItem('backrooms-settings', JSON.stringify({ quality: 'low', muted: true, grain: false })));
    await page.goto('/'); await expect(page.locator('#boot')).toHaveCount(0);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    await page.locator('#coop-button').tap(); await page.locator('#nickname-input').fill('Исследователь_123'); await page.locator('#connect-submit').tap();
    await page.locator('#rename-input').scrollIntoViewIfNeeded(); await expect(page.locator('#rename-submit')).toBeVisible();
    expect(await page.locator('.lobby-screen').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThan(2);
    await page.locator('#lobby-start').tap(); await expect(page.locator('body')).toHaveAttribute('data-state', 'playing');
    expect(await page.evaluate(() => document.pointerLockElement === null)).toBe(true);
    await page.locator('#radio-toggle').tap(); await expect(page.locator('#radio-input')).toBeVisible();
    const box = await page.locator('#radio').boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await page.locator('#radio-input').fill('связь есть'); await page.locator('#chat-send').tap();
    await expect(page.locator('#radio-lines')).toContainText('связь есть'); await expect(page.locator('#radio-input')).toBeHidden();
  } finally { await context.close(); }
});
