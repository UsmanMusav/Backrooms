import { test, expect } from '@playwright/test';

test('wall markings, almond water, the warning-wall blackout and the Watcher', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 400 });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/tests/browser-harness.html');
  await page.waitForFunction(() => 'harness' in window);
  const result = await page.evaluate(() => {
    // @ts-expect-error Test-only harness.
    const g = window.harness.game, C = window.harness.CELL;
    cancelAnimationFrame(g.animationId);
    g.applySettings({ ...g.settings, intro: false });
    const messages: string[] = []; g.callbacks.onMessage = (text: string, title?: string) => messages.push(`${title}: ${text}`);
    g.start();
    const count = (name: string) => { let n = 0; g.scene.traverse((o: { name: string }) => { if (o.name === name) n++; }); return n; };
    const marks = { arrows: count('FuseArrow1') + count('FuseArrow2') + count('FuseArrow3'), warning: count('WarningWall'), scrawls: count('Scrawl'), bottles: count('AlmondWater') };

    // Almond water: look at a bottle, drink it, stamina refills and sprinting drains far slower.
    const bottle = g.interactables.find((i: { type: string }) => i.type === 'water');
    g.camera.position.set(bottle.position.x + 1.1, 1.63, bottle.position.z); g.yaw = Math.PI / 2; g.pitch = -.85;
    g.camera.rotation.set(g.pitch, g.yaw, 0, 'YXZ'); g.camera.updateMatrixWorld(true);
    g.target = g.findInteraction();
    const targetType = g.target?.type;
    g.stamina = .1; g.interact();
    const afterDrink = { stamina: g.stamina, taken: bottle.taken, hidden: !bottle.object.visible, boost: g.boostUntil - g.elapsed };

    // Warning wall: walking up to it kills the lights; moving in the dark makes noise.
    const wall = g.markings.warning;
    g.camera.position.set(wall.x, 1.63, wall.z); g.pitch = 0;
    const lights: number[] = [];
    g.keys.add('KeyW');
    for (let i = 0; i < 150; i++) { g.elapsed += 1 / 30; g.updatePlayer(1 / 30); lights.push(g.warningLight()); g.camera.position.set(wall.x, 1.63, wall.z); }
    g.keys.delete('KeyW');
    const warning = { min: Math.min(...lights), end: lights.at(-1), moved: g.warningMoved, noisy: g.noisyUntil > 0, message: messages.find(m => m.startsWith('НЕ ДВИГАЙСЯ')) ?? null };

    // Watcher: appears behind the player, is noticed when turned toward, vanishes when stared at.
    const s = g.stalker;
    g.camera.position.set(4 * C, 1.63, 8 * C); g.camera.rotation.set(0, Math.PI, 0, 'YXZ'); g.camera.updateMatrixWorld(true);
    s.nextAt = 0; s.update(1 / 30, 200, g.camera, false, true);
    const spawned = s.active, p = s.position.clone();
    const distance = Math.hypot(p.x - g.camera.position.x, p.z - g.camera.position.z);
    g.camera.lookAt(p.x, 1.6, p.z); g.camera.updateMatrixWorld(true);
    const events: string[] = [];
    for (let i = 0; i < 90 && s.active; i++) { const e = s.update(1 / 30, 200 + i / 30, g.camera, false, true); if (e.seen !== undefined) events.push('seen'); if (e.vanished !== undefined) events.push('vanished'); }
    const disabled = (() => { s.nextAt = 0; s.update(1 / 30, 400, g.camera, false, false); return s.active; })();
    return { marks, targetType, afterDrink, warning, spawned, distance, events, gone: !s.active, glitch: s.glitch, disabled };
  });
  expect(result.marks.arrows).toBeGreaterThanOrEqual(6);
  expect(result.marks.warning).toBe(1);
  expect(result.marks.scrawls).toBeGreaterThanOrEqual(8);
  expect(result.marks.bottles).toBe(5);
  expect(result.targetType).toBe('water');
  expect(result.afterDrink.stamina).toBe(1);
  expect(result.afterDrink.taken && result.afterDrink.hidden).toBe(true);
  expect(result.afterDrink.boost).toBeGreaterThan(25);
  expect(result.warning.min).toBeLessThan(.1);
  expect(result.warning.end).toBe(1);
  expect(result.warning.moved && result.warning.noisy).toBe(true);
  expect(result.warning.message).toMatch(/Вы двигались/);
  expect(result.spawned).toBe(true);
  expect(result.distance).toBeGreaterThan(10.5);
  expect(result.events).toEqual(['seen', 'vanished']);
  expect(result.gone).toBe(true);
  expect(result.glitch).toBeGreaterThan(.5);
  expect(result.disabled).toBe(false);
  expect(errors).toEqual([]);
});
