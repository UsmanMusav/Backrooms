import { build } from 'esbuild';
await build({ entryPoints: ['server/index.ts'], outfile: '.desktop/server.cjs', platform: 'node', format: 'cjs', target: 'node22', bundle: true, external: ['ws'], sourcemap: false, minify: true });
console.log('Authoritative multiplayer server built.');
