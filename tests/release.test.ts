import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseInfo, RELEASE } from '../scripts/release-info.mjs';

test('release names, tags and Windows metadata follow package version', () => {
  assert.deepEqual(releaseInfo('2.14.7'), { version: '2.14.7', tag: 'v2.14.7', filename: 'Backrooms-Mimic-2.14.7-Windows-x64.exe', windowsVersion: [2, 14, 7, 0] });
  assert.equal(RELEASE.tag, `v${RELEASE.version}`);
});

test('test versions retain their suffix without invalid Windows version numbers', () => {
  const release = releaseInfo('1.2.0-beta.3');
  assert.equal(release.tag, 'v1.2.0-beta.3');
  assert.equal(release.filename, 'Backrooms-Mimic-1.2.0-beta.3-Windows-x64.exe');
  assert.deepEqual(release.windowsVersion, [1, 2, 0, 0]);
});

test('release versions cannot inject paths, commands or oversized PE numbers', () => {
  for (const version of ['../1.2.3', '1.2.3/escape', '1.2', 'v1.2.3', '1.2.3;exit', '1.2.3\n', '01.2.3', '70000.1.0', null, 123]) assert.throws(() => releaseInfo(version));
});
