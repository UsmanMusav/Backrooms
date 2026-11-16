import { test, expect } from '@playwright/test';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index';
import { PROTOCOL } from '../shared/protocol';
import type { ServerMessage } from '../shared/protocol';

// The fixture can advance its own authoritative world. No debug API is shipped to browsers.
test('network movement, local pause, team victory, host migration, second round and defeat', async ({ page }) => {
  test.setTimeout(180_000);
  const server = createGameServer();
  const port = await server.listen(0, '127.0.0.1');
  const host = new WebSocket(`ws://127.0.0.1:${port}/ws`, PROTOCOL);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await once(host, 'open');
    const welcome = new Promise<Extract<ServerMessage, { t: 'welcome' }>>(resolve => {
      host.on('message', data => {
        const message = JSON.parse(data.toString()) as ServerMessage;
        if (message.t === 'welcome') resolve(message);
      });
    });
    host.send(JSON.stringify({ t: 'create', name: 'Ведущий' }));
    const initial = await welcome;
    await page.addInitScript(() => localStorage.setItem('backrooms-settings', JSON.stringify({ quality: 'low', muted: true })));
    await page.goto('/');
    await expect(page.locator('#boot')).toHaveCount(0);
    await page.locator('#coop-button').click();
    await page.locator('#join-tab').click();
    await page.locator('#nickname-input').fill('Напарник');
    await page.locator('#server-input').fill(`http://127.0.0.1:${port}`);
    await page.locator('#room-code-input').fill(initial.room.code);
    await page.locator('#connect-submit').click();
    await expect(page.locator('#lobby-count')).toHaveText('2 / 4');
    await page.locator('#lobby-start').click();
    const room = server.rooms.get(initial.room.code)!;
    const own = [...room.members.values()].find(p => p.id !== initial.id)!;
    await expect.poll(() => own.ready).toBe(true);
    host.send(JSON.stringify({ t: 'start' }));
    await expect(page.locator('body')).toHaveAttribute('data-state', 'playing');
    const origin = { x: own.x, z: own.z };
    await page.keyboard.down('w');
    await expect.poll(() => Math.hypot(own.x - origin.x, own.z - origin.z)).toBeGreaterThan(0.1);
    await page.keyboard.up('w');
    await page.keyboard.press('p');
    await expect(page.locator('body')).toHaveAttribute('data-state', 'paused');
    await expect(page.locator('.state-description')).toContainText('Пауза не останавливает сервер');
    const pausedAt = room.elapsed;
    room.fuses[0] = true;
    await expect.poll(() => room.elapsed).toBeGreaterThan(pausedAt + 0.2);
    await page.locator('#resume-or-retry').click();
    await expect(page.locator('.progress-count')).toHaveText('1 / 3');
    own.alive = false;
    await expect(page.locator('body')).toHaveAttribute('data-state', 'dead');
    await expect(page.locator('.state-description')).toContainText('Напарники ещё идут');
    room.phase = 'won';
    await expect(page.locator('body')).toHaveAttribute('data-state', 'won');
    host.close();
    await expect(page.locator('#resume-or-retry')).toContainText('ВЕРНУТЬ КОМАНДУ В ЛОББИ');
    await page.locator('#resume-or-retry').click();
    await expect(page.locator('#lobby-count')).toHaveText('1 / 4');
    await expect(page.locator('#lobby-roster')).toContainText('ВЕДУЩИЙ ЭКСПЕДИЦИИ');
    await page.locator('#lobby-start').click();
    await expect(page.locator('body')).toHaveAttribute('data-state', 'playing');
    await expect(page.locator('.progress-count')).toHaveText('0 / 3');
    expect(room.round).toBe(2);
    own.alive = false;
    room.phase = 'lost';
    await expect(page.locator('body')).toHaveAttribute('data-state', 'dead');
    await expect(page.locator('#resume-or-retry')).toContainText('ВЕРНУТЬ КОМАНДУ В ЛОББИ');
    await page.locator('#resume-or-retry').click();
    await page.locator('#lobby-leave').click();
    await expect(page.locator('#start-button')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    host.terminate();
    await server.close();
  }
});
