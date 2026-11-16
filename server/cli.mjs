import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { createGameServer } = require('../.desktop/server.cjs');
const server = createGameServer({ distDir: resolve('dist') });
const port = await server.listen(Number(process.env.PORT) || 8787);
console.log(`Backrooms + Mimic server listening on 0.0.0.0:${port}`);
console.log('Open this server URL on every device. Room codes only work on the same server.');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.close().then(() => process.exit(0)); });
