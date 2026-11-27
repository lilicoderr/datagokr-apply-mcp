import test from 'node:test';
import assert from 'node:assert/strict';
import { createCache, cacheKey } from '../src/cache.js';

test('cacheKey: params 순서와 무관, 키 이름이 다르면 다른 키', () => {
  assert.equal(cacheKey('u', { a: 1, b: 2 }, 'k'), cacheKey('u', { b: 2, a: 1 }, 'k'));
  assert.notEqual(cacheKey('u', { a: 1 }, 'k1'), cacheKey('u', { a: 1 }, 'k2'));
  assert.notEqual(cacheKey('u1', {}, 'k'), cacheKey('u2', {}, 'k'));
});

test('cache: TTL 안에서는 적중, 지나면 만료', () => {
  let t = 1000;
  const c = createCache({ now: () => t });
  c.set('a', { v: 1 }, 5000);
  assert.deepEqual(c.get('a'), { v: 1 });
  t = 5999;
  assert.deepEqual(c.get('a'), { v: 1 });
  t = 6000;
  assert.equal(c.get('a'), undefined);
  assert.deepEqual(c.stats(), { size: 0, hits: 2, misses: 1 });
});

test('cache: ttl 0 이하는 저장하지 않음', () => {
  const c = createCache();
  c.set('a', 1, 0);
  c.set('b', 1, -5);
  assert.equal(c.stats().size, 0);
});

test('cache: max 초과 시 가장 오래 안 쓴 항목부터 제거(LRU)', () => {
  const c = createCache({ max: 2 });
  c.set('a', 1, 1e6);
  c.set('b', 2, 1e6);
  c.get('a'); // a 를 최근 사용으로
  c.set('c', 3, 1e6);
  assert.equal(c.get('b'), undefined);
  assert.equal(c.get('a'), 1);
  assert.equal(c.get('c'), 3);
});

test('cache: clear', () => {
  const c = createCache();
  c.set('a', 1, 1e6);
  c.clear();
  assert.equal(c.get('a'), undefined);
});

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from '../src/mcp.js';
import { createRegistry } from '../src/registry.js';
import { createUsage } from '../src/usage.js';
import { registerTools } from '../src/tools.js';

const tmp = (n) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'datago-')), n);
const okBody = { response: { header: { resultCode: '00' }, body: { items: { item: [{ a: 1 }] }, totalCount: 1 } } };
function countingFetch() {
  const fn = async () => { fn.n++; return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(okBody) }; };
  fn.n = 0;
  return fn;
}
const call = (s, args) => s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'call_api', arguments: args } });

function setup() {
  const s = createServer();
  const reg = createRegistry(tmp('c.json'));
  reg.saveKey('k', 'plainkey0123456789');
  const usage = createUsage(tmp('u.json'));
  const fetchImpl = countingFetch();
  registerTools(s, { registry: reg, fetchImpl, usage, cache: createCache(), sleep: async () => {} });
  return { s, fetchImpl, usage };
}

test('call_api cacheSeconds: 두 번째 호출은 네트워크·사용량 없이 캐시 적중', async () => {
  const { s, fetchImpl, usage } = setup();
  await call(s, { url: 'http://x/api', params: { q: 1 }, cacheSeconds: 60 });
  const second = JSON.parse((await call(s, { url: 'http://x/api', params: { q: 1 }, cacheSeconds: 60 })).result.content[0].text);
  assert.equal(fetchImpl.n, 1);
  assert.equal(second.요약.캐시적중, true);
  assert.equal(usage.summary().total, 1);
});

test('call_api cacheSeconds 없으면 매번 호출, params 가 다르면 별도 캐시', async () => {
  const { s, fetchImpl } = setup();
  await call(s, { url: 'http://x/api' });
  await call(s, { url: 'http://x/api' });
  assert.equal(fetchImpl.n, 2);
  await call(s, { url: 'http://x/api', params: { q: 1 }, cacheSeconds: 60 });
  await call(s, { url: 'http://x/api', params: { q: 2 }, cacheSeconds: 60 });
  assert.equal(fetchImpl.n, 4);
});
