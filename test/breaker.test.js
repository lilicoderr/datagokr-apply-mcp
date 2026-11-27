import test from 'node:test';
import assert from 'node:assert/strict';
import { createBreaker, CircuitOpenError } from '../src/breaker.js';
import { callApi } from '../src/datago.js';

test('breaker: opens after threshold, half-open after cooldown, closes on success', () => {
  let t = 0;
  const b = createBreaker({ threshold: 2, cooldownMs: 1000, now: () => t });
  const u = 'https://apis.data.go.kr/x';
  assert.equal(b.check(u), 0);
  b.failure(u); b.failure(u);
  assert.equal(b.state(u), 'open');
  assert.equal(b.check(u), 1000);
  t = 1001;
  assert.equal(b.state(u), 'half-open');
  assert.equal(b.check(u), 0);          // 시험 호출 허용
  assert.ok(b.check(u) > 0);            // 동시 두 번째는 차단
  b.success(u);
  assert.equal(b.state(u), 'closed');
});

test('breaker: hosts are independent', () => {
  const b = createBreaker({ threshold: 1 });
  b.failure('https://a.example/x');
  assert.equal(b.check('https://b.example/x'), 0);
  assert.ok(b.check('https://a.example/y') > 0);
});

test('callApi: fails fast when circuit is open', async () => {
  const b = createBreaker({ threshold: 1, cooldownMs: 60000 });
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: false, status: 503, headers: new Map(), text: async () => '' }; };
  const opts = { url: 'https://apis.data.go.kr/x', serviceKey: 'K'.repeat(20), fetchImpl, sleep: async () => {}, retries: 0, breaker: b };
  await callApi(opts);
  const before = calls;
  await assert.rejects(() => callApi(opts), CircuitOpenError);
  assert.equal(calls, before);
});
