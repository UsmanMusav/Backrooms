/* Bundled into a Windows Node SEA. The renderer has no Node.js access. */
const { getAsset, getAssetKeys, isSea } = require('node:sea');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { mkdirSync, readFileSync, writeFileSync, renameSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { networkInterfaces, homedir } = require('node:os');
const { spawnSync } = require('node:child_process');
const { createGameServer } = require('../server/index.ts');
const { version: GAME_VERSION } = require('../package.json');

async function boot() {
  const home = join(process.env.LOCALAPPDATA || homedir(), 'Noclip', 'Backrooms-Mimic');
  mkdirSync(home, { recursive: true });
  const asset = name => Buffer.from(getAsset(name));
  const assets = isSea() ? new Map(getAssetKeys().filter(k => k.startsWith('client/')).map(k => [k.slice(7), asset(k)])) : undefined;
  if (process.argv.includes('--self-test')) {
    if (!assets?.has('index.html') || asset('webview.node').toString('ascii', 0, 2) !== 'MZ') throw new Error('Embedded resources are invalid');
    const testServer = createGameServer({ assets });
    const port = await testServer.listen(0, '127.0.0.1');
    const response = await fetch(`http://127.0.0.1:${port}/`);
    const html = await response.text();
    const health = await fetch(`http://127.0.0.1:${port}/api/health`).then(r => r.json());
    if (!html.includes('BACKROOMS') || !health.ok) throw new Error('Embedded client/server smoke test failed');
    const model = await fetch(`http://127.0.0.1:${port}/models/explorer.glb`);
    const modelBytes = Buffer.from(await model.arrayBuffer());
    if (model.headers.get('content-type') !== 'model/gltf-binary' || modelBytes.toString('ascii', 0, 4) !== 'glTF') throw new Error('Embedded animated explorer is missing');
    const modelJSON = JSON.parse(modelBytes.toString('utf8', 20, 20 + modelBytes.readUInt32LE(12)));
    if (modelJSON.animations?.length !== 8 || modelJSON.skins?.[0]?.joints?.length !== 65) throw new Error('Explorer skeleton/animation bundle is invalid');
    for (const name of ['explorer-albedo.jpg', 'explorer-normal.jpg', 'explorer-roughness.png', 'explorer-eyes.jpg', 'CC0-1.0.txt', 'Quaternius-Standard-License.txt']) {
      const resource = await fetch(`http://127.0.0.1:${port}/models/${name}`);
      if (!resource.ok || (await resource.arrayBuffer()).byteLength < 500) throw new Error(`Missing local model dependency: ${name}`);
    }
    if (!asset('THIRD_PARTY_NOTICES.txt').toString('utf8').includes('Quaternius')) throw new Error('Character attribution is missing');
    const { WebSocket } = require('ws');
    const code = await new Promise((resolveRoom, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, 'backrooms-v1');
      ws.on('open', () => ws.send(JSON.stringify({ t: 'create', name: 'BuildCheck' })));
      ws.on('error', reject);
      ws.on('message', data => { const message = JSON.parse(String(data)); if (message.t === 'welcome') { ws.close(); resolveRoom(message.room.code); } });
      setTimeout(() => { ws.terminate(); reject(new Error('Embedded WebSocket smoke test timed out')); }, 5000).unref();
    });
    await testServer.close();
    console.log(JSON.stringify({ ok: true, protocol: health.protocol, assets: assets.size, characterClips: modelJSON.animations.length, room: code, node: process.versions.node }));
    process.exit(0);
  }
  if (isSea()) {
    const bytes = asset('webview.node');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const native = join(home, `webview-${hash.slice(0, 16)}.node`);
    let valid = false;
    try { valid = createHash('sha256').update(readFileSync(native)).digest('hex') === hash; } catch { /* first launch */ }
    if (!valid) {
      const temporary = native + `.${process.pid}.tmp`;
      writeFileSync(temporary, bytes, { mode: 0o600 });
      renameSync(temporary, native);
    }
    globalThis.__backroomsNativeBinding = native;
    writeFileSync(join(home, 'THIRD_PARTY_NOTICES.txt'), asset('THIRD_PARTY_NOTICES.txt'));
  } else {
    globalThis.__backroomsNativeBinding = createRequire(__filename).resolve('@webviewjs/webview-win32-x64-msvc');
  }
  const { Application, FullscreenType } = require('@webviewjs/webview');
  const server = createGameServer({ assets, distDir: resolve(__dirname, '../dist') });
  let port;
  try { port = await server.listen(8787); }
  catch (error) { if (error.code !== 'EADDRINUSE') throw error; port = await server.listen(0); }
  const origin = `http://127.0.0.1:${port}`;
  const addresses = Object.values(networkInterfaces()).flat().filter(v => v && !v.internal && v.family === 'IPv4').map(v => `http://${v.address}:${port}`);
  const app = new Application();
  let stopping = false;
  const quit = () => {
    if (stopping) return null;
    stopping = true;
    app.exit();
    void server.close().finally(() => process.exit(0));
    const timer = setTimeout(() => process.exit(0), 1500);
    timer.unref();
    return null;
  };
  app.on('application-close-requested', quit);
  app.on('window-close-requested', quit);
  const window = app.createBrowserWindow({ title: 'BACKROOMS · MIMIC', width: 1440, height: 900, resizable: true, showMenu: false });
  window.setMinSize(960, 600);
  window.setWindowIcon(isSea() ? asset('icon.rgba') : readFileSync(join(__dirname, 'icon.rgba')), 64, 64);
  const context = app.createWebContext({ dataDirectory: join(home, 'WebView2') });
  const webview = window.createWebview({ url: origin, enableDevtools: false, webContext: context, navigationHandler: url => url === origin || url.startsWith(origin + '/'), newWindowHandler: () => false });
  let fullscreen = false;
  webview.expose('backroomsDesktop', {
    getConnectionInfo: () => ({ addresses, port, platform: 'win32', version: GAME_VERSION, engine: 'WebView2' }),
    toggleFullscreen: () => { fullscreen = !fullscreen; window.setFullscreen(fullscreen ? FullscreenType.Borderless : null); return fullscreen; },
    quit,
  });
  // Keep native wrappers alive for the entire window lifetime.
  globalThis.__backroomsDesktop = { app, window, webview, context, server };
  app.run();
}

boot().catch(error => {
  const home = join(process.env.LOCALAPPDATA || homedir(), 'Noclip', 'Backrooms-Mimic');
  try { mkdirSync(home, { recursive: true }); writeFileSync(join(home, 'startup-error.log'), String(error.stack || error)); } catch { /* cannot write diagnostic */ }
  if (process.platform === 'win32') {
    const message = 'Не удалось открыть BACKROOMS MIMIC. Установите Microsoft Edge WebView2 Runtime и Visual C++ 2015–2022 Redistributable x64 (Windows 10/11). Диагностика: %LOCALAPPDATA%\\Noclip\\Backrooms-Mimic\\startup-error.log';
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${message}', 'BACKROOMS MIMIC')`], { windowsHide: true, timeout: 30000 });
  } else console.error(error);
  process.exit(1);
});
