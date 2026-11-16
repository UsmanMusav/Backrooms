import { build } from 'esbuild';
import { RELEASE } from './release-info.mjs';
import { inject } from 'postject';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { x as extract } from 'tar';
import { NtExecutable, NtExecutableResource, Resource, Data } from 'resedit';

const NODE = '24.22.3';
const WEBVIEW = '0.6.0';
const stage = resolve('.cache/backrooms-windows/stage');
const cache = resolve('.cache/backrooms-windows/packages');
const output = resolve('artifacts', RELEASE.filename);
mkdirSync(stage, { recursive: true });
mkdirSync(cache, { recursive: true });
mkdirSync(resolve('artifacts'), { recursive: true });

async function packageFiles(name, version, folder) {
  const target = join(cache, folder);
  const marker = join(target, '.complete');
  if (existsSync(marker)) return join(target, 'package');
  mkdirSync(target, { recursive: true });
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const filename = execFileSync(npm, ['pack', `${name}@${version}`, '--pack-destination', cache, '--ignore-scripts', '--silent'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim().split('\n').at(-1);
  await extract({ file: join(cache, filename), cwd: target });
  writeFileSync(marker, 'ok');
  return join(target, 'package');
}

console.log('Fetching pinned Windows runtime and native WebView2 binding from npm...');
const windows = await packageFiles('node-win-x64', NODE, `node-win-${NODE}`);
const native = await packageFiles('@webviewjs/webview-win32-x64-msvc', WEBVIEW, `webview-win-${WEBVIEW}`);
const hostName = `node-${process.platform}-${process.arch}`;
const host = process.platform === 'win32' && process.arch === 'x64' ? windows : await packageFiles(hostName, NODE, `${hostName}-${NODE}`);
const hostNode = process.platform === 'win32' ? join(host, 'bin/node.exe') : join(host, 'bin/node');
if (process.platform !== 'win32') chmodSync(hostNode, 0o755);
const nativeFile = readdirSync(native).find(file => file.endsWith('.node'));
if (!nativeFile) throw new Error('Windows native binding not found');

await build({
  entryPoints: ['desktop/main.cjs'], outfile: join(stage, 'main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node24', minify: true,
  external: ['bufferutil', 'utf-8-validate'],
  plugins: [{ name: 'sea-native-binding', setup(builder) {
    builder.onLoad({ filter: /webview[\\/]js-bindings\.js$/ }, () => ({ contents: "module.exports = require('node:module').createRequire(process.execPath)(globalThis.__backroomsNativeBinding);", loader: 'js' }));
  } }],
});
const resources = { 'webview.node': join(native, nativeFile), 'icon.rgba': resolve('desktop/icon.rgba') };
function walk(directory, prefix = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const key = prefix + entry.name;
    if (entry.isDirectory()) walk(join(directory, entry.name), key + '/');
    else resources['client/' + key] = join(directory, entry.name);
  }
}
walk(resolve('dist'));
const notices = [
  `BACKROOMS MIMIC ${RELEASE.version} · Third-party notices`,
  'Node.js: MIT and bundled third-party licenses. https://github.com/nodejs/node/blob/v' + NODE + '/LICENSE',
];
for (const dependency of ['three', 'ws', '@webviewjs/webview']) {
  const dir = resolve('node_modules', dependency);
  const license = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].map(f => join(dir, f)).find(existsSync);
  if (license) notices.push(`\n=== ${dependency} ===\n` + readFileSync(license, 'utf8'));
}
for (const font of ['manrope', 'oswald', 'ibm-plex-mono']) {
  const license = join(resolve('node_modules/@fontsource', font), 'LICENSE');
  if (existsSync(license)) notices.push(`\n=== ${font} ===\n` + readFileSync(license, 'utf8'));
}
const nodeLicense = resolve('desktop/licenses/Node-v24.22.3-LICENSE.txt');
notices.push('\n=== Node.js ===\n' + readFileSync(nodeLicense, 'utf8'));
writeFileSync(join(stage, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n'));
resources['THIRD_PARTY_NOTICES.txt'] = join(stage, 'THIRD_PARTY_NOTICES.txt');
const config = { main: join(stage, 'main.cjs'), output: join(stage, 'sea.blob'), disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, assets: resources };
writeFileSync(join(stage, 'sea-config.json'), JSON.stringify(config, null, 2));
console.log('Preparing platform-independent SEA blob (no snapshots or code cache)...');
execFileSync(hostNode, ['--experimental-sea-config', join(stage, 'sea-config.json')], { stdio: 'inherit' });
const windowsExe = ['bin/node.exe', 'node.exe'].map(f => join(windows, f)).find(existsSync);
if (!windowsExe) throw new Error('Windows Node executable missing');
copyFileSync(windowsExe, output);
let pe = readFileSync(output);
if (pe.toString('ascii', 0, 2) !== 'MZ') throw new Error('Runtime is not a PE executable');
const optional = pe.readUInt32LE(0x3c) + 24;
const directories = optional + (pe.readUInt16LE(optional) === 0x20b ? 112 : 96);
const certOffset = pe.readUInt32LE(directories + 4 * 8);
const certSize = pe.readUInt32LE(directories + 4 * 8 + 4);
pe.writeUInt32LE(0, directories + 4 * 8);
pe.writeUInt32LE(0, directories + 4 * 8 + 4);
pe.writeUInt32LE(0, optional + 64); // checksum invalid after resource injection
if (certOffset && certOffset + certSize === pe.length) pe = pe.subarray(0, certOffset);
pe.writeUInt16LE(2, optional + 68); // Windows GUI: no console window behind the game.
const brandedExe = NtExecutable.from(pe, { ignoreCert: true });
const brandedResources = NtExecutableResource.from(brandedExe);
for (const version of Resource.VersionInfo.fromEntries(brandedResources.entries)) {
  version.setFileVersion(...RELEASE.windowsVersion, 1033);
  version.setProductVersion(...RELEASE.windowsVersion, 1033);
  for (const language of version.getAllLanguagesForStringValues()) version.setStringValues(language, {
    CompanyName: 'NOCLIP', FileDescription: 'BACKROOMS MIMIC — cooperative horror',
    ProductName: 'BACKROOMS MIMIC', InternalName: 'Backrooms-Mimic',
    OriginalFilename: RELEASE.filename, ProductVersion: RELEASE.version,
    LegalCopyright: 'NOCLIP Project 2026. Includes Node.js and other third-party components; see notices.',
  });
  version.outputToResourceEntries(brandedResources.entries);
}
Resource.IconGroupEntry.replaceIconsForResource(brandedResources.entries, 1, 1033,
  Data.IconFile.from(readFileSync('desktop/icon.ico')).icons.map(item => item.data));
// Keep all existing RVAs fixed. Shrinking Node's resource section and moving
// .reloc can confuse the SEA injector and invalidate ASLR relocation mapping.
const resourceSection = brandedExe.getSectionByEntry(2);
if (!resourceSection) throw new Error('Windows resource section missing');
const metadata = brandedResources.generateResourceData(resourceSection.info.virtualAddress, brandedExe.getFileAlignment(), true, false);
if (metadata.bin.byteLength > resourceSection.info.sizeOfRawData) throw new Error('Branding exceeds the original PE resource section');
Buffer.from(metadata.bin).copy(pe, resourceSection.info.pointerToRawData);
writeFileSync(output, pe);
console.log('Injecting game, server, native binding and all assets into Windows EXE...');
await inject(output, 'NODE_SEA_BLOB', readFileSync(config.output), { sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2' });
const bytes = readFileSync(output);
const sha256 = createHash('sha256').update(bytes).digest('hex');
writeFileSync(output + '.sha256', sha256 + '  ' + output.split(/[\\/]/).at(-1) + '\n');
writeFileSync(resolve('artifacts/ПРОЧИТАЙ-ПЕРЕД-ИГРОЙ.txt'), '\ufeff' + readFileSync('desktop/README-Windows.txt', 'utf8').replaceAll('{{VERSION}}', RELEASE.version).replace(/\r?\n/g, '\r\n'));
copyFileSync(join(stage, 'THIRD_PARTY_NOTICES.txt'), resolve('artifacts/THIRD_PARTY_NOTICES.txt'));
console.log(`${output}\n${(bytes.length / 1048576).toFixed(1)} MiB\nSHA-256: ${sha256}`);
