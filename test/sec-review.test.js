// 적대적 보안 검토에서 찾은 문제의 회귀 테스트. 키는 전부 가짜 값.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { isPrivateHost, assertSafeTarget } from '../src/security.js';
import { pinnedFetch } from '../src/safefetch.js';
import { callApi } from '../src/datago.js';
import { createRegistry } from '../src/registry.js';
import { redactString } from '../src/logger.js';

const KEY = 'FAKEfake+KEY/0123456789abcdef==';
const ENC = encodeURIComponent(KEY);
const ENC_LOWER = ENC.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase());
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'datago-rev-')), 'c.json');
const reply = (body, type = 'application/json') => async () => ({ ok: true, status: 200, headers: { get: () => type }, text: async () => body });

async function listen(t, handler) {
  const hits = [];
  const srv = http.createServer((req, res) => { hits.push(req.url); handler(req, res); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => { srv.closeAllConnections(); srv.close(); });
  return { port: srv.address().port, hits };
}

test('private ranges: IPv6 embeddings, multicast/reserved, trailing dot', () => {
  for (const h of ['::ffff:0:127.0.0.1', '::127.0.0.1', '::7f00:1', '64:ff9b::7f00:1', '64:ff9b:1::a00:1', '2002:7f00:1::1',
    '0:0:0:0:0:ffff:10.0.0.1', '0:0:0:0:0:0:0:1', 'fec0::1', 'ff02::1', '224.0.0.1', '240.0.0.1', '255.255.255.255',
    '198.18.0.1', '192.0.0.8', 'localhost.', 'svc.internal.']) assert.equal(isPrivateHost(h), true, h);
  for (const h of ['8.8.8.8', '::ffff:8.8.8.8', '2001:4860:4860::8888', 'apis.data.go.kr']) assert.equal(isPrivateHost(h), false, h);
});

test('URL error messages do not echo a serviceKey', () => {
  assert.throws(() => assertSafeTarget(`http://[bad/x?serviceKey=${ENC}`, {}), (e) => !e.message.includes(ENC));
});

test('DNS rebinding: the address used for the connection is the one that is checked', async (t) => {
  const { port, hits } = await listen(t, (_q, res) => res.end('{}'));
  const rebound = (_h, _o, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]);
  await assert.rejects(pinnedFetch(`http://rebind.data.go.kr:${port}/x?serviceKey=${ENC}`, {}, { env: {}, lookup: rebound }), /내부\/로컬/);
  assert.equal(hits.length, 0);
});

test('pinnedFetch: IP literal is checked too', async (t) => {
  const { port, hits } = await listen(t, (_q, res) => res.end('{}'));
  await assert.rejects(pinnedFetch(`http://127.0.0.1:${port}/x`, {}, { env: {} }), /내부\/로컬/);
  assert.equal(hits.length, 0);
});

test('pinnedFetch: reads gzip bodies, never follows redirects, honours abort', async (t) => {
  const { port, hits } = await listen(t, (req, res) => {
    if (req.url === '/redir') { res.writeHead(302, { location: '/target' }); res.end(); return; }
    if (req.url === '/hang') return;
    res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
    res.end(zlib.gzipSync('{"a":"가"}'));
  });
  const env = { DATAGO_ALLOW_LOCAL: '1' };
  const r = await pinnedFetch(`http://127.0.0.1:${port}/ok`, {}, { env });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Content-Type'), 'application/json');
  assert.equal(await r.text(), '{"a":"가"}');
  await assert.rejects(pinnedFetch(`http://127.0.0.1:${port}/redir`, {}, { env }), /redirect/);
  assert.ok(!hits.includes('/target'));
  await assert.rejects(pinnedFetch(`http://127.0.0.1:${port}/hang`, { signal: AbortSignal.timeout(100) }, { env }), (e) => e.name === 'AbortError' || e.name === 'TimeoutError');
});

test('a server echoing the request cannot put the key into the result', async () => {
  const bodies = [
    [`{"response":{"header":{"resultCode":"30","resultMsg":"bad key ${KEY}"}},"echo":"?serviceKey=${ENC}"}`, 'application/json'],
    [JSON.stringify({ echo: KEY }).replaceAll('/', '\\/'), 'application/json'],
    [`<html>not found: /x?serviceKey=${ENC_LOWER}</html>`, 'text/html'],
  ];
  for (const [body, type] of bodies) {
    const r = await callApi({ url: 'https://apis.data.go.kr/x', serviceKey: KEY, fetchImpl: reply(body, type), retries: 0 });
    const out = JSON.stringify([r.data, r.resultMsg, r.hint]);
    for (const v of [KEY, ENC, ENC_LOWER]) assert.ok(!out.includes(v), out);
  }
});

test('network error messages do not contain the key', async () => {
  const boom = async (u) => { throw new TypeError(`Failed to parse URL from ${u} (key ${KEY})`); };
  await assert.rejects(callApi({ url: 'https://apis.data.go.kr/x', serviceKey: KEY, fetchImpl: boom, retries: 0 }),
    (e) => !e.message.includes(KEY) && !e.message.includes(ENC));
});

test('corrupt config: the stderr notice does not quote file contents', (t) => {
  const f = tmp();
  fs.writeFileSync(f, 'SECRETVALUE0123456789');
  const seen = [];
  t.mock.method(console, 'error', (m) => seen.push(String(m)));
  createRegistry(f).listKeys();
  assert.equal(seen.length, 1);
  assert.ok(!seen[0].includes('SECRET'), seen[0]);
});

test('listEndpoints masks keys embedded in saved URLs or params; calls still get the raw value', () => {
  const r = createRegistry(tmp());
  r.saveEndpoint('a', `https://apis.data.go.kr/x?serviceKey=${ENC}`, '', { ServiceKey: KEY, q: '1' });
  const shown = JSON.stringify(r.listEndpoints());
  assert.ok(!shown.includes(ENC) && !shown.includes(KEY), shown);
  assert.equal(r.getEndpoint('a').params.ServiceKey, KEY);
});

test('inherited property names are not treated as saved keys', () => {
  const r = createRegistry(tmp());
  r.saveKey('main', KEY);
  assert.equal(r.removeKey('constructor'), false);
  assert.equal(r.removeEndpoint('toString'), false);
  assert.throws(() => r.setDefaultKey('toString'));
});

test('redactString masks a leading serviceKey= and encoded forms of known secrets', () => {
  assert.equal(redactString('serviceKey=abc123&x=1'), 'serviceKey=***&x=1');
  assert.ok(!redactString(`path /${ENC}/json`, [KEY]).includes(ENC));
});
