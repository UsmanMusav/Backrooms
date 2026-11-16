import { readFileSync, writeFileSync, copyFileSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { RELEASE } from './release-info.mjs';

// No --clobber: a published version is an immutable download, never a rolling build.
const files = [RELEASE.filename, RELEASE.filename + '.sha256', 'README-Windows-RU.txt', 'THIRD_PARTY_NOTICES.txt'];
copyFileSync('artifacts/ПРОЧИТАЙ-ПЕРЕД-ИГРОЙ.txt', 'artifacts/README-Windows-RU.txt');
for (const file of files) if (statSync(resolve('artifacts', file)).size === 0) throw new Error(`Empty release asset: ${file}`);
const checksum = createHash('sha256').update(readFileSync(resolve('artifacts', RELEASE.filename))).digest('hex');
if (readFileSync(resolve('artifacts', RELEASE.filename + '.sha256'), 'utf8').split(' ')[0] !== checksum) throw new Error('Release checksum does not match the executable');
const changelog = readFileSync('CHANGELOG.md', 'utf8').split('\n');
const start = changelog.findIndex(line => line === `## ${RELEASE.version}` || line.startsWith(`## ${RELEASE.version} `));
if (start < 0) throw new Error(`Add release notes for ${RELEASE.version} to CHANGELOG.md first`);
let end = changelog.findIndex((line, i) => i > start && line.startsWith('## '));
if (end < 0) end = changelog.length;
const notes = changelog.slice(start + 1, end).join('\n').trim();
if (!notes) throw new Error('Release notes must not be empty');
if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify({ tag: RELEASE.tag, prerelease: true, files, sha256: checksum, notes }, null, 2));
  process.exit(0);
}
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (git(['status', '--porcelain'])) throw new Error('Commit and push source changes before publishing');
const commit = git(['rev-parse', 'HEAD']);
function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', timeout: 300_000, maxBuffer: 4 * 1024 * 1024 }).trim();
}
const repo = process.env.GH_REPO || process.env.GITHUB_REPOSITORY || JSON.parse(gh(['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner;
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('Invalid GitHub repository');
function optionalAPI(path) {
  const result = spawnSync('gh', ['api', path], { encoding: 'utf8', timeout: 60_000 });
  if (result.status === 0) return JSON.parse(result.stdout);
  if (result.status === 1 && /HTTP 404/.test(result.stderr)) return null;
  throw new Error(`GitHub request failed: ${result.stderr || result.error || result.status}`);
}
const endpoint = `repos/${repo}/releases/tags/${RELEASE.tag}`;
const findRelease = () => optionalAPI(endpoint) ?? JSON.parse(gh(['api', `repos/${repo}/releases?per_page=100`])).find(release => release.tag_name === RELEASE.tag) ?? null;
let release = findRelease();
if (release && !release.draft) {
  const missing = files.filter(file => !release.assets.some(asset => asset.name === file && asset.state === 'uploaded'));
  if (missing.length) throw new Error(`Published release has missing assets: ${missing.join(', ')}. It will not be overwritten automatically.`);
  console.log(`Already published; preserving the existing release: ${release.html_url}`);
  process.exit(0);
}
if (release && release.target_commitish !== commit) throw new Error('An existing draft targets a different commit; use a new version or review the draft manually');
let reference = optionalAPI(`repos/${repo}/git/ref/tags/${RELEASE.tag}`);
for (let depth = 0; reference?.object.type === 'tag' && depth < 8; depth++) reference = JSON.parse(gh(['api', `repos/${repo}/git/tags/${reference.object.sha}`]));
if (reference && (reference.object.type !== 'commit' || reference.object.sha !== commit)) throw new Error('The version tag already points to a different commit');
mkdirSync('.cache', { recursive: true });
const notesFile = resolve('.cache/backrooms-release-notes.md');
writeFileSync(notesFile, notes + '\n');
if (!release) {
  console.log(gh(['release', 'create', RELEASE.tag, '--repo', repo, '--target', commit, '--title', `BACKROOMS MIMIC ${RELEASE.version}`, '--notes-file', notesFile, '--draft', '--prerelease']));
  release = findRelease();
  if (!release) throw new Error('Created release draft could not be found');
}
const missing = files.filter(file => !release.assets.some(asset => asset.name === file && asset.state === 'uploaded'));
if (missing.length) console.log(gh(['release', 'upload', RELEASE.tag, '--repo', repo, ...missing.map(file => resolve('artifacts', file))]));
const uploaded = JSON.parse(gh(['api', `repos/${repo}/releases/${release.id}`]));
for (const file of files) {
  const asset = uploaded.assets.find(asset => asset.name === file && asset.state === 'uploaded');
  if (!asset || asset.size !== statSync(resolve('artifacts', file)).size) throw new Error(`Release asset was not uploaded completely: ${file}`);
}
console.log(gh(['release', 'edit', RELEASE.tag, '--repo', repo, '--draft=false', '--prerelease']));
const published = JSON.parse(gh(['api', endpoint]));
console.log(`Published ${published.html_url}`);
for (const asset of published.assets) console.log(`${asset.name}: ${asset.browser_download_url}`);
