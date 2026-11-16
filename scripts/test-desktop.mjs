import { inject } from 'postject';
import { RELEASE } from './release-info.mjs';
import { readFileSync, copyFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
let executable = resolve('artifacts', RELEASE.filename);
if (process.platform !== 'win32') {
  const binary = resolve(`.cache/backrooms-windows/packages/node-${process.platform}-${process.arch}-24.22.3/package/bin/node`);
  executable = resolve('.cache/backrooms-windows/desktop-smoke');
  copyFileSync(binary, executable);
  await inject(executable, 'NODE_SEA_BLOB', readFileSync('.cache/backrooms-windows/stage/sea.blob'), { sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', machoSegmentName: 'NODE_SEA' });
  chmodSync(executable, 0o755);
}
const result = spawnSync(executable, ['--self-test'], { encoding: 'utf8', timeout: 30000, env: { ...process.env, LOCALAPPDATA: resolve('.cache/desktop-selftest') } });
if (result.status !== 0 || !result.stdout.includes('"ok":true')) throw new Error(`Desktop bundle smoke test failed (${result.status}): ${result.stdout}\n${result.stderr}\n${result.error ?? ''}`);
console.log(result.stdout.trim());
if (process.platform !== 'win32') console.log('Embedded bundle and networking tested on the host OS. Windows GUI execution still requires a Windows machine.');
