import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { RELEASE } from './release-info.mjs';
import { NtExecutable, NtExecutableResource, Resource } from 'resedit';
const file = `artifacts/${RELEASE.filename}`;
const data = readFileSync(file);
assert.equal(data.toString('ascii', 0, 2), 'MZ');
const pe = data.readUInt32LE(0x3c);
assert.equal(data.readUInt32LE(pe), 0x00004550);
assert.equal(data.readUInt16LE(pe + 4), 0x8664, 'Expected Windows x64');
assert.equal(data.readUInt16LE(pe + 24), 0x20b, 'Expected PE32+');
assert.equal(data.readUInt16LE(pe + 24 + 68), 2, 'Expected a GUI executable, not a console launcher');
const sectionTable = pe + 24 + data.readUInt16LE(pe + 20);
const sections = Array.from({ length: data.readUInt16LE(pe + 6) }, (_, i) => {
  const at = sectionTable + i * 40;
  return { name: data.toString('ascii', at, at + 8).replace(/\0/g, ''), virtualSize: data.readUInt32LE(at + 8),
    rva: data.readUInt32LE(at + 12), rawSize: data.readUInt32LE(at + 16), rawOffset: data.readUInt32LE(at + 20) };
}).sort((a, b) => a.rva - b.rva);
for (let i = 0; i < sections.length; i++) {
  const section = sections[i];
  assert.ok(section.rawOffset + section.rawSize <= data.length, `${section.name} exceeds file bounds`);
  if (sections[i + 1]) assert.ok(section.rva + Math.max(section.virtualSize, section.rawSize) <= sections[i + 1].rva, `${section.name} overlaps the next virtual section`);
}
const directories = pe + 24 + 112;
assert.equal(data.readUInt32LE(directories + 4 * 8), 0, 'Modified EXE must not retain an invalid vendor signature');
const relocRva = data.readUInt32LE(directories + 5 * 8);
const relocSize = data.readUInt32LE(directories + 5 * 8 + 4);
const relocSection = sections.find(s => relocRva >= s.rva && relocRva + relocSize <= s.rva + Math.max(s.virtualSize, s.rawSize));
assert.ok(relocSection && relocSize > 0, 'ASLR relocation table missing');
const relocOffset = relocSection.rawOffset + relocRva - relocSection.rva;
let offset = 0;
while (offset < relocSize) {
  const blockSize = data.readUInt32LE(relocOffset + offset + 4);
  assert.ok(blockSize >= 8 && blockSize % 4 === 0 && offset + blockSize <= relocSize, 'Corrupt ASLR relocation block');
  offset += blockSize;
}
assert.equal(offset, relocSize);
assert.ok(data.includes(Buffer.from('NODE_SEA_BLOB', 'utf16le')), 'Embedded SEA resource missing');
assert.ok(data.includes(Buffer.from('NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:1')), 'SEA fuse was not enabled');
for (const asset of ['client/index.html', 'client/models/explorer.glb', 'client/models/explorer-albedo.jpg', 'client/models/CC0-1.0.txt', 'webview.node', 'icon.rgba', 'THIRD_PARTY_NOTICES.txt']) assert.ok(data.includes(Buffer.from(asset)), `${asset} missing`);
const resources = NtExecutableResource.from(NtExecutable.from(data));
const version = Resource.VersionInfo.fromEntries(resources.entries)[0];
assert.equal(version.getStringValues({ lang: 1033, codepage: 1200 }).ProductName, 'BACKROOMS MIMIC');
assert.equal(version.getStringValues({ lang: 1033, codepage: 1200 }).FileVersion, RELEASE.windowsVersion.join('.'));
assert.ok(Resource.IconGroupEntry.fromEntries(resources.entries).length > 0, 'Game icon missing');
const hash = createHash('sha256').update(data).digest('hex');
assert.equal(hash, readFileSync(file + '.sha256', 'utf8').split(' ')[0]);
assert.ok(data.length < 128 * 1048576, 'Artifact exceeds the delivery budget');
console.log(JSON.stringify({ ok: true, format: 'PE32+ GUI x64', sizeMiB: +(data.length / 1048576).toFixed(1), sha256: hash }, null, 2));
