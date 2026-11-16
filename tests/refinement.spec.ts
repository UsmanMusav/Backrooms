import { test, expect } from '@playwright/test';

test('real engine holsters the torch, applies optional bob, reads local notes and resets cleanly', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 400 });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/tests/browser-harness.html');
  await page.waitForFunction(() => 'harness' in window);
  const result = await page.evaluate(() => {
    // @ts-expect-error The harness is a test-only page, excluded from the production entry.
    const g = window.harness.game;
    cancelAnimationFrame(g.animationId); g.start();
    const tick = (frames = 60) => { for (let i = 0; i < frames; i++) { g.updatePlayer(1 / 60); g.updateFlashlight(1 / 60); } };
    tick(); const raised = g.flashlightModel.visible && g.flashlight.visible && g.motion.raised === 1;
    g.toggleFlashlight(); tick(50);
    const hidden = !g.flashlightModel.visible && !g.flashlight.visible && g.motion.raised === 0;
    g.toggleFlashlight(); tick(8); const midway = g.flashlightModel.position.y;
    g.toggleFlashlight(); tick(5); g.toggleFlashlight(); tick();
    const redrawn = g.flashlightModel.visible && g.flashlight.visible && g.motion.raised === 1 && midway < g.flashlightModel.position.y;
    g.keys.add('KeyW'); const heights: number[] = [], rolls: number[] = [];
    for (let i = 0; i < 120; i++) { tick(1); heights.push(g.camera.position.y); rolls.push(g.camera.rotation.z); }
    const bob = Math.max(...heights) - Math.min(...heights), roll = Math.max(...rolls) - Math.min(...rolls);
    g.applySettings({ ...g.settings, headBob: false }); tick();
    const disabled = g.camera.position.y === 1.63 && g.camera.rotation.z === 0 && g.camera.fov === 72;
    g.keys.clear();
    const note = g.interactables.find((i: { type: string }) => i.type === 'note');
    g.camera.position.set(note.position.x, 1.63, note.position.z + 1.5); g.yaw = 0;
    g.pitch = Math.atan2(note.position.y - 1.63, 1.5); g.camera.rotation.set(g.pitch, 0, 0, 'YXZ'); g.camera.updateMatrixWorld(true);
    g.target = g.findInteraction(); const targetIsNote = g.target?.type === 'note';
    let sent = 0; g.coop = true; g.networkSend = () => sent++; g.interact(); g.coop = false;
    const localNote = targetIsNote && note.taken && !note.object.visible && sent === 0 && g.fuses === 0 && g.hintUntil === g.elapsed + 20;
    g.start(); const reset = !note.taken && note.object.visible && g.flashOn && !g.entityActive;
    g.toggleFlashlight(); g.pause();
    for (let i = 0; i < 60; i++) g.updateFlashlight(1 / 60);
    const holstersWhilePaused = !g.flashlightModel.visible;
    g.menu(); const menuHidden = !g.flashlightModel.visible && !g.flashlight.visible;
    return { raised, hidden, redrawn, bob, roll, disabled, localNote, reset, holstersWhilePaused, menuHidden };
  });
  expect(result).toMatchObject({ raised: true, hidden: true, redrawn: true, disabled: true, localNote: true, reset: true, holstersWhilePaused: true, menuHidden: true });
  expect(result.bob).toBeGreaterThan(.04); expect(result.roll).toBeGreaterThan(.009);
  expect(errors).toEqual([]);
});

test('human and disguised Mimic share geometry, with independent animated skeletons and safe death/reset', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 400 });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/tests/character-harness.html'); await page.waitForFunction(() => 'characterHarness' in window);
  const result = await page.evaluate(() => {
    // @ts-expect-error Dev-only character harness.
    const { avatars, actors, THREE } = window.characterHarness;
    const [a, b] = avatars;
    const bodyA = a.model.getObjectByName('Explorer_Suit'), bodyB = b.model.getObjectByName('Explorer_Suit');
    const hand = b.model.getObjectByName('hand_l'); b.model.updateMatrixWorld(true); const before = hand.getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < 15; i++) b.update(actors[1], 1 / 60, i / 60, true);
    b.model.updateMatrixWorld(true); const changed = before.distanceTo(hand.getWorldPosition(new THREE.Vector3())) > .01;
    const torchAttached = a.model.getObjectByName('MachinedFlashlight').parent.name === 'hand_l';
    actors[0].flashlight = false; a.update(actors[0], .04, 1, true);
    const hiddenTorch = !a.model.getObjectByName('MachinedFlashlight').visible;
    actors[1].alive = false; b.update(actors[1], .04, 1, true);
    const death = b.active.getClip().name === 'death' && !b.model.getObjectByName('MachinedFlashlight').visible;
    const c = avatars[2]; c.reset(); actors[2].revealed = false; actors[2].name = actors[0].name; c.update(actors[2], .04, 1, true);
    const reset = c.model.getObjectByName('Head').scale.y === 1 && c.active.getClip().name === 'torch';
    const oldModel = b.model; b.dispose();
    return { shared: bodyA.geometry === bodyB.geometry, independent: bodyA.skeleton !== bodyB.skeleton && a.mixer !== b.mixer, changed, torchAttached, hiddenTorch, death, reset, removed: !b.group.parent, oldModelStillValid: !!oldModel };
  });
  expect(result).toEqual({ shared: true, independent: true, changed: true, torchAttached: true, hiddenTorch: true, death: true, reset: true, removed: true, oldModelStillValid: true });
  expect(errors).toEqual([]);
});

test('a missing local model shows a useful retry screen instead of a broken menu', async ({ page }) => {
  await page.route('**/models/explorer.glb', route => route.abort());
  await page.goto('/');
  await expect(page.locator('.webgl-error')).toContainText('МОДЕЛЬ НЕ ЗАГРУЖЕНА');
  await expect(page.locator('#reload-button')).toBeVisible();
  await expect(page.locator('#boot')).toHaveCount(0);
});
