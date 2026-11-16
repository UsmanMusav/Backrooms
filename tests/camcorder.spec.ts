import { test, expect } from '@playwright/test';

test('camcorder zoom: hold C and roll the wheel, sensitivity follows FOV, release returns to wide', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 400 });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/tests/browser-harness.html');
  await page.waitForFunction(() => 'harness' in window);
  // @ts-expect-error Test-only harness.
  await page.evaluate(() => { const g = window.harness.game; cancelAnimationFrame(g.animationId); g.start(); });
  const tick = (frames = 90) => page.evaluate(frames => {
    // @ts-expect-error Test-only harness.
    const g = window.harness.game; for (let i = 0; i < frames; i++) g.updatePlayer(1 / 60); return { fov: g.camera.fov, zoom: g.zoom, focus: g.zoomFocus };
  }, frames);
  const wide = await tick();
  await page.mouse.wheel(0, -600); const wheelAlone = await tick(30);
  await page.keyboard.down('c'); const held = await tick();
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -400);
  const zoomed = await tick();
  // @ts-expect-error Test-only harness.
  const look = await page.evaluate(() => { const g = window.harness.game, before = g.yaw; g.look(100, 0); return Math.abs(g.yaw - before); });
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -400);
  const clamped = await tick();
  await page.keyboard.up('c'); const released = await tick(120);
  // @ts-expect-error Test-only harness.
  const wideLook = await page.evaluate(() => { const g = window.harness.game, before = g.yaw; g.look(100, 0); return Math.abs(g.yaw - before); });
  expect(wide.zoom).toBe(1); expect(wheelAlone.zoom).toBe(1);
  expect(held.zoom).toBeGreaterThan(2.3); expect(held.fov).toBeLessThan(wide.fov / 1.8);
  expect(zoomed.zoom).toBeGreaterThan(held.zoom); expect(zoomed.fov).toBeLessThan(held.fov);
  expect(clamped.zoom).toBeLessThanOrEqual(6.0001);
  expect(look).toBeLessThan(wideLook / 2);
  expect(released.zoom).toBe(1); expect(released.fov).toBeCloseTo(wide.fov, 3);
  expect(errors).toEqual([]);
});

test('textured surfaces use several variants and props are detailed models, not single boxes', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 400 });
  await page.goto('/tests/browser-harness.html');
  await page.waitForFunction(() => 'harness' in window);
  const result = await page.evaluate(() => {
    // @ts-expect-error Test-only harness.
    const g = window.harness.game; const names = new Map<string, number>();
    g.scene.traverse((o: { name: string }) => { const base = o.name.replace(/-\d+$/, ''); if (o.name) names.set(base, (names.get(base) || 0) + 1); });
    const meshCount = (name: string) => { let count = 0, vertices = 0; g.scene.getObjectByName(name)?.traverse((o: { isMesh?: boolean; geometry?: { attributes: { position: { count: number } } } }) => { if (o.isMesh) { count++; vertices += o.geometry!.attributes.position.count; } }); return { count, vertices }; };
    const wallVariants = g.scene.children.filter((o: { name: string }) => o.name.startsWith('Wallpaper-')).length;
    const floorVariants = g.scene.children.filter((o: { name: string }) => o.name.startsWith('Floor-')).length;
    const ceilingVariants = g.scene.children.filter((o: { name: string }) => o.name.startsWith('Ceiling-')).length;
    const macro = g.scene.getObjectByName('Floor-0').material.customProgramCacheKey().startsWith('macro-');
    return { wallVariants, floorVariants, ceilingVariants, macro, chair: meshCount('OfficeChair'), door: meshCount('FireExitDoors'), board: meshCount('IndustrialSwitchboard'), boxes: names.get('CardboardBox') || 0, open: names.get('OpenCardboardBox') || 0, grilles: names.get('ReturnGrille') || 0, outlets: names.get('WallOutlet') || 0 };
  });
  expect(result.wallVariants).toBeGreaterThanOrEqual(5); expect(result.floorVariants).toBeGreaterThanOrEqual(4); expect(result.ceilingVariants).toBeGreaterThanOrEqual(3);
  expect(result.macro).toBe(true);
  expect(result.chair.count).toBeGreaterThan(10); expect(result.chair.vertices).toBeGreaterThan(20000);
  expect(result.door.count).toBeGreaterThan(15); expect(result.board.count).toBeGreaterThan(20);
  expect(result.boxes).toBeGreaterThan(5); expect(result.open).toBeGreaterThan(0); expect(result.grilles).toBe(6); expect(result.outlets).toBeGreaterThan(5);
});

test('real HUD shows the camcorder viewfinder and the setting removes it', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.addInitScript(() => localStorage.setItem('backrooms-settings', JSON.stringify({ quality: 'low', muted: true, intro: false, camcorder: sessionStorage.getItem('camoff') !== '1' })));
  await page.goto('/');
  await expect(page.locator('#boot')).toHaveCount(0);
  await page.getByRole('button', { name: 'ВОЙТИ В ЗАКУЛИСЬЕ', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'playing');
  await expect(page.locator('#camcorder')).toBeVisible();
  await expect(page.locator('.cam-corner')).toHaveCount(4);
  await expect(page.locator('#cam-clock')).toHaveText(/^AM 3:1\d:\d\d$/);
  await expect(page.locator('.hud-shortcuts')).toContainText('ЗУМ');
  await page.keyboard.down('c'); await page.mouse.wheel(0, -500);
  await expect(page.locator('#cam-zoom')).toHaveClass(/active/);
  await expect(page.locator('#cam-zoom-value')).not.toHaveText('1.0×');
  await page.keyboard.up('c');
  await page.evaluate(() => sessionStorage.setItem('camoff', '1'));
  await page.reload(); await expect(page.locator('#boot')).toHaveCount(0);
  await page.getByRole('button', { name: 'ВОЙТИ В ЗАКУЛИСЬЕ', exact: true }).click();
  await expect(page.locator('#camcorder')).toBeHidden();
});

test('touch zoom button cycles optical zoom and fits a 390 px phone', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    await page.addInitScript(() => localStorage.setItem('backrooms-settings', JSON.stringify({ quality: 'low', muted: true, intro: false })));
    await page.goto('/'); await expect(page.locator('#boot')).toHaveCount(0);
    await page.getByRole('button', { name: 'ВОЙТИ В ЗАКУЛИСЬЕ', exact: true }).tap();
    const zoom = page.locator('#touch-zoom'); await expect(zoom).toBeVisible();
    const box = await zoom.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await zoom.tap(); await expect(zoom).toHaveAttribute('aria-pressed', 'true'); await expect(zoom).toHaveText('2.5×');
    await expect(page.locator('#cam-zoom')).toHaveClass(/active/);
    await zoom.tap(); await expect(zoom).toHaveText('5×');
    await zoom.tap(); await expect(zoom).toHaveAttribute('aria-pressed', 'false');
  } finally { await context.close(); }
});
