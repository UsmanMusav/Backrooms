/* Optional art tool; normal builds use checked-in public/models assets.
 * Uses only CC0 asset blobs, never code from the source mirrors. Requires gh.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const directory = '.cache/character-source/'; mkdirSync(directory, { recursive: true });
const base = 'Universal Base Characters[Standard]/Universal Base Characters[Standard]/';
const sources = [
  { repo: 'J-Ponzo/gltf-universal-animation-library', tree: 'e24c23cf2a1323488a3faa226ea7ea21f644b73e', files: ['glTF/AnimationLibrary_Godot_Standard.gltf', 'glTF/AnimationLibrary_Godot_Standard.bin', 'LICENSE'] },
  { repo: 'NafisRayan/Animate-Rigged-Humanoid-No-Blender', tree: '5821923af517ac5fdc82505faa92a0d575fc1b1a', files: [
    ...['Superhero_Male_FullBody.gltf', 'Superhero_Male_FullBody.bin', 'T_Superhero_Male_Dark.png', 'T_Eye_Brown.png'].map(file => base + 'Base Characters/Godot - UE/' + file), base + 'License_Standard.txt',
  ] },
];
const api = path => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 }));
const blobHash = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
for (const source of sources) {
  const tree = api(`repos/${source.repo}/git/trees/${source.tree}?recursive=1`);
  if (tree.sha !== source.tree || tree.truncated) throw new Error('Unexpected asset source tree');
  for (const path of source.files) {
    const entry = tree.tree.find(file => file.path === path && file.type === 'blob');
    if (!entry) throw new Error(`Missing CC0 source: ${path}`);
    const output = directory + path.split('/').at(-1);
    if (existsSync(output) && blobHash(readFileSync(output)) === entry.sha) { console.log(`Cached ${output}`); continue; }
    const blob = api(`repos/${source.repo}/git/blobs/${entry.sha}`);
    if (blob.encoding !== 'base64') throw new Error('Unexpected Git blob encoding');
    const bytes = Buffer.from(blob.content, 'base64');
    if (blobHash(bytes) !== entry.sha) throw new Error('Asset source hash mismatch');
    writeFileSync(output, bytes); console.log(`Downloaded ${output}`);
  }
}
console.log('CC0 character source files ready. See public/models/CREDITS.md.');
