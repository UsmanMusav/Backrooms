import { test, expect } from '@playwright/test';

test('two independent browsers join a room, ready up, see chat safely, and enter the same expedition', async ({ browser }) => {
  test.setTimeout(180_000);
  const hostContext = await browser.newContext({ viewport: { width: 840, height: 680 } });
  const guestContext = await browser.newContext({ viewport: { width: 840, height: 680 } });
  const errors: string[] = [];
  for (const context of [hostContext, guestContext]) {
    await context.addInitScript(() => { try { localStorage.setItem('backrooms-settings', JSON.stringify({ quality: 'low', muted: true, grain: false })); } catch { /* about:blank has no storage */ } });
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  }
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await host.goto('/');
    await expect(host.locator('#boot')).toHaveCount(0);
    await host.locator('#coop-button').click();
    await host.locator('#nickname-input').fill('Илья');
    await host.locator('#connect-submit').click();
    await expect(host.getByRole('region', { name: 'Лобби экспедиции' })).toBeVisible();
    const code = (await host.locator('#lobby-code').textContent())!;
    expect(code).toMatch(/^[A-Z2-9]{6}$/);

    await guest.goto('/');
    await expect(guest.locator('#boot')).toHaveCount(0);
    await guest.locator('#coop-button').click();
    await guest.locator('#join-tab').click();
    await guest.locator('#nickname-input').fill('Серёга');
    await guest.locator('#room-code-input').fill(code);
    await guest.locator('#connect-submit').click();
    await expect(guest.locator('#lobby-code')).toHaveText(code);
    await expect(host.locator('#lobby-count')).toHaveText('2 / 4');
    await expect(host.locator('#lobby-start')).toBeDisabled();
    await guest.locator('#lobby-chat-input').fill('<b>связь проверена</b>');
    await guest.locator('#lobby-chat-input').press('Enter');
    await expect(host.locator('#lobby-chat-lines')).toContainText('<b>связь проверена</b>');
    await expect(host.locator('#lobby-chat-lines b')).toHaveCount(0);
    await guest.locator('#lobby-start').click();
    await expect(host.locator('#lobby-start')).toBeEnabled();
    await host.locator('#lobby-start').click();
    await expect(host.locator('#coop-status')).toContainText(code);
    await expect(guest.locator('#coop-status')).toContainText(code);
    await expect(host.locator('#objective-title')).toHaveText('Найдите предохранители');
    await expect(guest.locator('#objective-title')).toHaveText('Найдите предохранители');
    await host.keyboard.press('t');
    await expect(host.locator('#radio-input')).toBeVisible();
    await host.locator('#radio-input').fill('Я у входа. Не отходи.');
    await host.locator('#radio-input').press('Enter');
    await expect(guest.locator('#radio-lines')).toContainText('Я у входа. Не отходи.');
    await expect(host.locator('#radio-input')).not.toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test('missing rooms fail visibly and do not strand the interface', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('backrooms-settings', JSON.stringify({ quality: 'low', muted: true })));
  await page.goto('/');
  await expect(page.locator('#boot')).toHaveCount(0);
  await page.locator('#coop-button').click();
  await page.locator('#join-tab').click();
  await page.locator('#room-code-input').fill('ZZZZZZ');
  await page.locator('#connect-submit').click();
  await expect(page.locator('#connect-error')).toContainText('Комната не найдена');
  await expect(page.locator('#connect-submit')).toBeEnabled();
  await page.locator('#create-tab').click();
  await page.locator('#connect-submit').click();
  await expect(page.locator('#lobby-code')).toHaveText(/^[A-Z2-9]{6}$/);
  await page.locator('#lobby-leave').click();
  await expect(page.locator('#start-button')).toBeVisible();
});
