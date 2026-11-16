import { test, expect } from '@playwright/test';

const CLIPS = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'a1', 'a2', 'a3'];

test('found-footage prologue: street take, backing to the kerb, noclip, waking on Level 0', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 400 });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/tests/browser-harness.html');
  await page.waitForFunction(() => 'harness' in window);
  for (const clip of CLIPS) {
    const response = await page.request.get(`/audio/intro/${clip}.mp3`);
    expect(response.status(), clip).toBe(200);
    expect((await response.body()).byteLength, clip).toBeGreaterThan(4000);
  }
  const result = await page.evaluate(() => {
    // @ts-expect-error Test-only harness.
    const g = window.harness.game;
    cancelAnimationFrame(g.animationId);
    const frames: { phase: string; subtitle: string | null; prompt: string | null; stamp: string; glitch: number; blackout: number }[] = [];
    g.callbacks.onIntro = (f: { phase: string; subtitle: { speaker: string; text: string } | null; prompt: string | null; stamp: string; glitch: number; blackout: number }) =>
      frames.push({ phase: f.phase, subtitle: f.subtitle ? `${f.subtitle.speaker}: ${f.subtitle.text}` : null, prompt: f.prompt, stamp: f.stamp, glitch: f.glitch, blackout: f.blackout });
    g.playIntro();
    const state = g.state, scene = g.intro.scene;
    const names = new Set<string>(); let houses = 0;
    scene.traverse((o: { name: string }) => { names.add(o.name); if (o.name === 'House') houses++; });
    let guard = 0, renderedStreet = false, backPrompt = false;
    while (g.state === 'intro' && guard++ < 4000) {
      const before = g.intro?.phase;
      if (before === 'backup') { if (!backPrompt) backPrompt = !!frames.at(-1)?.prompt; else g.setIntroBack(true); }
      g.updateIntro(1 / 30);
      if (g.renderPass.scene === scene) renderedStreet = true;
    }
    g.setIntroBack(false);
    const phases = [...new Set(frames.map(f => f.phase))];
    const subtitles = [...new Set(frames.map(f => f.subtitle).filter(Boolean))];
    const maxGlitch = Math.max(...frames.filter(f => f.phase === 'fall').map(f => f.glitch));
    const stamps = [...new Set(frames.map(f => f.stamp))];
    return {
      state, names: [...names], houses, phases, subtitles, backPrompt, renderedStreet, maxGlitch, stamps, finalState: g.state,
      disposed: g.intro === undefined && g.renderPass.scene === g.scene && g.renderPass.camera === g.camera,
      uniforms: { glitch: g.film.uniforms.glitch.value, blackout: g.film.uniforms.blackout.value },
      pose: { y: g.camera.position.y, yaw: g.yaw, roll: g.camera.rotation.z }, steps: guard,
    };
  });
  expect(result.state).toBe('intro');
  for (const name of ['FoundFootageStreet', 'Director', 'MaskedActress', 'Friend', 'PaperBagMask', 'ParkedSedan', 'PicketFence', 'KerbBehindCamera', 'UtilityPole', 'Tree', 'EveningSky']) expect(result.names, name).toContain(name);
  expect(result.houses).toBeGreaterThanOrEqual(6);
  expect(result.phases).toEqual(['card', 'play', 'take', 'backup', 'fall', 'void', 'wake', 'done']);
  expect(result.subtitles.length).toBe(9);
  expect(result.subtitles[0]).toMatch(/^АРТЁМ: Так… мотор/);
  expect(result.subtitles).toContain('ЛЕНА: Я в этой маске вообще ничего не вижу!');
  expect(result.backPrompt).toBe(true);
  expect(result.renderedStreet).toBe(true);
  expect(result.maxGlitch).toBeGreaterThan(.9);
  expect(result.stamps).toEqual(['ИЮЛ. 4 1991', 'НОЯ.16 1998']);
  expect(result.finalState).toBe('playing');
  expect(result.disposed).toBe(true);
  expect(result.uniforms).toEqual({ glitch: 0, blackout: 0 });
  expect(result.pose.y).toBeCloseTo(1.63, 2); expect(result.pose.yaw).toBeCloseTo(-2.65, 3); expect(result.pose.roll).toBe(0);
  expect(errors).toEqual([]);
});

test('real menu plays the tape by default, shows the viewfinder and Space/skip jumps into Level 0', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.addInitScript(() => localStorage.setItem('backrooms-settings', JSON.stringify({ quality: 'low', muted: true })));
  await page.goto('/');
  await expect(page.locator('#boot')).toHaveCount(0);
  await page.getByRole('button', { name: 'ВОЙТИ В ЗАКУЛИСЬЕ', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'intro');
  const overlay = page.locator('#intro-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveAttribute('data-phase', 'card');
  await expect(page.locator('#intro-card')).toContainText('Монтаж не производился');
  await expect(page.locator('#hud')).toBeHidden();
  await expect(overlay).toHaveAttribute('data-phase', /play|take/, { timeout: 20000 });
  await expect(page.locator('#intro-date')).toHaveText('ИЮЛ. 4 1991');
  await expect(page.locator('.intro-rec')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'playing');
  await expect(overlay).toBeHidden();
  await expect(page.locator('#hud')).toBeVisible();
  // The same tape can be switched off in settings; the skip button also works.
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.setItem('backrooms-settings', JSON.stringify({ quality: 'low', muted: true, intro: true })));
  await page.reload(); await expect(page.locator('#boot')).toHaveCount(0);
  await page.getByRole('button', { name: 'НАСТРОЙКИ', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Вступительная запись' })).toBeChecked();
  await page.getByRole('button', { name: 'ГОТОВО' }).click();
  await page.getByRole('button', { name: 'ВОЙТИ В ЗАКУЛИСЬЕ', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'intro');
  // A locked pointer belongs to the canvas; once released (Esc in a real browser) the button is clickable.
  await page.evaluate(() => document.exitPointerLock());
  await page.getByRole('button', { name: /ПРОПУСТИТЬ/ }).click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'playing');
});
