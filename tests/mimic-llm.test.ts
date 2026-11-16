import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { createLLMPlanner, llmConfig, plannerFromEnvironment, MIMIC_PROMPT } from '../server/mimic-llm.ts';
import type { MimicObservation } from '../shared/mind.ts';

const observation: MimicObservation = { phase: 'masked', name: 'Ника', cell: { x: 8, z: 6 }, action: 'follow', fuses: 1, powered: false,
  players: [{ alias: 'p0', name: 'Илья', alive: true, visible: false }], chat: [{ name: 'Илья', text: 'ты где?', source: 'player', alias: 'p0' }] };
const result = { action: 'follow', target: 'p0', copy: 'p0', flashlight: 'match', duration: 6, say: 'я в следующем проходе, подожди' };
const response = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { 'Content-Type': 'application/json' } });
const config = () => llmConfig({ MIMIC_LLM_URL: 'http://127.0.0.1:11434/v1/chat/completions', MIMIC_LLM_MODEL: 'test-model' })!;

async function endpoint(handler: (body: unknown, res: ServerResponse, authorization?: string) => void) {
  const requests: unknown[] = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += String(chunk);
    const body = JSON.parse(raw); requests.push(body); handler(body, res, req.headers.authorization);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No endpoint');
  return { url: `http://127.0.0.1:${address.port}/v1/chat/completions`, requests,
    close: () => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }) };
}

test('LLM is opt-in, local HTTP is supported, remote HTTPS requires explicit data-sharing consent', () => {
  assert.equal(llmConfig({}), null); assert.equal(plannerFromEnvironment({}), undefined);
  assert.equal(config().external, false);
  const remote = llmConfig({ MIMIC_LLM_URL: 'https://model.example.invalid/v1/chat/completions', MIMIC_LLM_MODEL: 'example', MIMIC_ALLOW_REMOTE_AI: '1', MIMIC_LLM_RPM: '999', MIMIC_LLM_TIMEOUT_MS: '99999' })!;
  assert.equal(remote.external, true); assert.equal(remote.requestsPerMinute, 60); assert.equal(remote.timeoutMs, 15000);
  for (const env of [
    { MIMIC_LLM_URL: 'not a url' },
    { MIMIC_LLM_URL: 'http://remote.invalid/v1/chat/completions', MIMIC_ALLOW_REMOTE_AI: '1' },
    { MIMIC_LLM_URL: 'https://remote.invalid/v1/chat/completions' },
    { MIMIC_LLM_URL: 'http://user:password@localhost/v1/chat/completions' },
    { MIMIC_LLM_URL: 'http://localhost/v1/chat/completions?api_key=secret' },
    { MIMIC_LLM_URL: 'file:///etc/hosts' },
    { MIMIC_LLM_URL: 'http://localhost/v1/chat/completions', MIMIC_LLM_MODEL: '' },
    { MIMIC_LLM_URL: 'http://localhost/v1/chat/completions', MIMIC_LLM_KEY: 'x\r\ninjected' },
  ]) assert.throws(() => llmConfig({ MIMIC_LLM_MODEL: 'example', ...env }));
});

test('a real HTTP fixture exercises OpenAI-compatible JSON requests, server-only auth and a validated plan', async () => {
  const fixture = await endpoint((_body, res, auth) => {
    assert.equal(auth, 'Bearer TEST_ONLY_NOT_A_REAL_KEY');
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
  });
  try {
    const planner = createLLMPlanner({ ...config(), url: fixture.url, key: 'TEST_ONLY_NOT_A_REAL_KEY' });
    assert.equal(planner.info().state, 'configured');
    const plan = await planner.plan(observation, new AbortController().signal);
    assert.deepEqual(plan, result); assert.deepEqual(planner.info(), { mode: 'llm', state: 'online', external: false });
    const request = fixture.requests[0] as Record<string, any>;
    assert.equal(request.model, 'test-model'); assert.equal(request.stream, false); assert.ok(request.max_tokens <= 220);
    assert.equal(request.messages[0].content, MIMIC_PROMPT); assert.match(request.messages[0].content, /UNTRUSTED GAME DATA/);
    assert.deepEqual(JSON.parse(request.messages[1].content), observation);
    assert.ok(!JSON.stringify(request).includes('TEST_ONLY_NOT_A_REAL_KEY'));
    assert.ok(!JSON.stringify(planner.info()).includes('127.0.0.1'));
    const reflecting = createLLMPlanner({ ...config(), key: 'TEST_ONLY_NOT_A_REAL_KEY' }, async () => response(JSON.stringify({ ...result, say: 'TEST_ONLY_NOT_A_REAL_KEY' })));
    assert.equal(await reflecting.plan(observation, new AbortController().signal), null, 'even a provider reflecting auth into content cannot leak it to chat');
  } finally { await fixture.close(); }
});

test('timeout and caller abort return null, do not hang the game or forward provider diagnostics', async () => {
  const fixture = await endpoint((_body, res) => { res.on('error', () => {}); /* deliberately no response */ });
  try {
    const planner = createLLMPlanner({ ...config(), url: fixture.url, timeoutMs: 100 });
    const at = performance.now(); assert.equal(await planner.plan(observation, new AbortController().signal), null);
    assert.ok(performance.now() - at < 1800); assert.equal(planner.info().state, 'fallback');
    const controller = new AbortController(); const pending = planner.plan(observation, controller.signal); controller.abort();
    assert.equal(await pending, null);
  } finally { await fixture.close(); }
});

test('server-wide token bucket and concurrency cap bound all rooms together', async () => {
  let time = 0, calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return response(JSON.stringify(result)); };
  const planner = createLLMPlanner(config(), fetcher, () => time), signal = new AbortController().signal;
  assert.ok(await planner.plan(observation, signal)); assert.ok(await planner.plan(observation, signal));
  assert.equal(await planner.plan(observation, signal), null); assert.equal(calls, 2);
  time = 5000; assert.ok(await planner.plan(observation, signal)); assert.equal(calls, 3);
  const blockingFetch: typeof fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options!.signal!.addEventListener('abort', () => reject(new Error('TEST_PROVIDER_INTERNAL_ERROR')), { once: true });
  });
  const busy = createLLMPlanner(config(), blockingFetch, () => time), controller = new AbortController();
  const a = busy.plan(observation, controller.signal), b = busy.plan(observation, controller.signal);
  time += 60_000; assert.equal(await busy.plan(observation, controller.signal), null);
  controller.abort(); assert.deepEqual(await Promise.all([a, b]), [null, null]);
});

test('malformed JSON, invented identities, commands, unsafe links, error bodies and oversized streams all fail closed', async () => {
  let time = 0, next: () => Response = () => response(JSON.stringify(result)), cancelled = false;
  const planner = createLLMPlanner(config(), async () => next(), () => time);
  const bad = [
    () => new Response('TEST_PROVIDER_INTERNAL_ERROR', { status: 401 }),
    () => new Response('not json'),
    () => response({ action: 'follow' }),
    () => response(JSON.stringify({ ...result, copy: 'p9' })),
    () => response(JSON.stringify({ ...result, action: 'kill' })),
    () => response(JSON.stringify({ ...result, say: 'https://example.invalid' })),
    () => response(JSON.stringify({ ...result, x: 15 })),
    () => new Response('x', { headers: { 'content-length': '20000' } }),
    () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(17_000)); }, cancel() { cancelled = true; } })),
  ];
  for (next of bad) { time += 60_000; assert.equal(await planner.plan(observation, new AbortController().signal), null); assert.equal(planner.info().state, 'fallback'); }
  assert.equal(cancelled, true);
  next = () => response('```json\n' + JSON.stringify(result) + '\n```'); time += 60_000;
  assert.deepEqual(await planner.plan(observation, new AbortController().signal), result); assert.equal(planner.info().state, 'online');
});
