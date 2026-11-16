import { readFileSync } from 'node:fs';

export function releaseInfo(version) {
  if (typeof version !== 'string') throw new Error('The game version must be a string');
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*))?$/.exec(version);
  if (!match || match[0] !== version) throw new Error(`Unsupported game version: ${version}`);
  const windowsVersion = match.slice(1, 4).map(Number).concat(0);
  if (windowsVersion.some(n => !Number.isSafeInteger(n) || n > 65535)) throw new Error('Windows version components must be between 0 and 65535');
  return { version, tag: `v${version}`, windowsVersion, filename: `Backrooms-Mimic-${version}-Windows-x64.exe` };
}

export const RELEASE = releaseInfo(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
