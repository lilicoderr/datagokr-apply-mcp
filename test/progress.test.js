process.env.DATAGO_ALLOW_LOCAL = '1';
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/mcp.js';
import { createRegistry } from '../src/registry.js';
import { registerTools } from '../src/tools.js';
import { registerApplyTools } from '../src/tools-apply.js';

const call = (name, args, token) => ({
  jsonrpc: '2.0', id: 7, method: 'tools/call',
  params: { name, arguments: args, ...(token !== undefined ? { _meta: { progressToken: token } } : {}) },
});

test('progressToken 이 있을 때만 notifications/progress, 단조 증가', async () => {
  const s = createServer({});
  s.tool('t', { description: 'x' }, async (_a, ctx) => {
    ctx.progress(1, 3, 'a'); ctx.progress(1, 3, 'dup'); ctx.progress(3, 3);
    return 'ok';
  });
  const got = [];
  await s.handle(call('t', {}, 'tok'), { notify: (n) => got.push(n) });
  assert.deepEqual(got.map((n) => n.params.progress), [1, 3]);
  assert.equal(got[0].method, 'notifications/progress');
  assert.equal(got[0].params.progressToken, 'tok');
  assert.equal(got[0].params.total, 3);
  assert.equal(got[1].params.message, undefined);
  const none = [];
  await s.handle(call('t', {}), { notify: (n) => none.push(n) });
  assert.equal(none.length, 0);
  await s.handle(call('t', {}, 0)); // notify 없어도 안전
});

test('fetch_all 이 페이지마다 진행률을 보낸다', async () => {
  const s = createServer({});
  const reg = createRegistry(path.join(os.tmpdir(), 'progress-never.json'));
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    const body = JSON.stringify({ response: { header: { resultCode: '00' }, body: { totalCount: 30, items: { item: [{ a: n }] } } } });
    return { ok: true, status: 200, text: async () => body, headers: { get: () => 'application/json' } };
  };
  registerTools(s, { registry: reg, fetchImpl, sleep: async () => {} });
  const got = [];
  const res = await s.handle(call('fetch_all', { url: 'https://apis.data.go.kr/x', serviceKey: 'k', numOfRows: 10, maxPages: 3 }, 'p1'),
    { notify: (m) => got.push(m) });
  assert.ok(!res.result.isError, JSON.stringify(res));
  assert.deepEqual(got.map((m) => m.params.progress), [1, 2, 3]);
  assert.equal(got[0].params.total, 3);
});

test('apply_api 가 항목마다 진행률을 보낸다', async () => {
  const s = createServer({});
  const apply = {
    isAvailable: () => true,
    applyForApis: async (ids, { onProgress }) => {
      ids.forEach((id, i) => onProgress(i + 1, ids.length, id));
      return { total: ids.length, done: ids.length, already: 0, failed: 0, needLogin: false, skipped: 0, invalid: [], duplicates: [], results: [] };
    },
  };
  registerApplyTools(s, { apply });
  const got = [];
  await s.handle(call('apply_api', { ids: ['15000314', '15057552'] }, 'a'), { notify: (m) => got.push(m) });
  assert.deepEqual(got.map((m) => m.params.progress), [1, 2]);
  assert.match(got[1].params.message, /2\/2/);
});

test('apply_api: 신청 성공 뒤 인증키를 자동 저장하고 출력에는 마스킹만 남긴다', async () => {
  const saved = [];
  const registry = { getKey: () => null, saveKey: (n, k) => { saved.push([n, k]); return { name: n, isDefault: true }; } };
  const FAKE = encodeURIComponent('FAKEFAKEFAKEfakeKEY+EXAMPLE/NOTAREALKEY0123456789abcdefghij==');
  const apply = {
    isAvailable: () => true,
    applyForApis: async () => ({ total: 1, done: 1, already: 0, failed: 0, needLogin: false, skipped: 0, invalid: [], duplicates: [], results: [{ idOrUrl: '15000314', ok: true }] }),
    fetchServiceKey: async () => ({ ok: true, keys: { encoding: FAKE, decoding: decodeURIComponent(FAKE) }, message: 'x' }),
  };
  const s = createServer({});
  registerApplyTools(s, { apply, registry });
  const res = await s.handle(call('apply_api', { idOrUrl: '15000314' }, 'k'), {});
  const sc = res.result.structuredContent;
  assert.equal(sc.key.saved, true);
  assert.equal(saved[0][1], FAKE);
  assert.ok(!JSON.stringify(res.result).includes('EXAMPLE'));
});

const FAKE2 = encodeURIComponent('FAKEFAKEFAKEfakeKEY+EXAMPLE/NOTAREALKEY0123456789abcdefghij==');
const mkApply = (keys) => ({
  isAvailable: () => true,
  fetchServiceKey: async () => ({ ok: true, keys, message: 'x' }),
});

test('apply_get_key: 검증 실패한 키는 저장하지 않고 save_key 안내', async () => {
  const saved = [];
  const registry = { getKey: () => null, saveKey: (n, k) => saved.push([n, k]) };
  const s = createServer({});
  registerApplyTools(s, { apply: mkApply({ encoding: 'SHORTSHORTSHORTSHORTSHORT', decoding: 'SHORTSHORTSHORTSHORTSHORT' }), registry });
  const res = await s.handle(call('apply_get_key', {}, 'v'), {});
  assert.equal(res.result.structuredContent.saved, false);
  assert.match(res.result.content[0].text, /save_key/);
  assert.equal(saved.length, 0);
});

test('apply_get_key: 같은 이름에 다른 키가 있으면 덮어쓰지 않고 새 이름으로 저장, 마스킹', async () => {
  const store = { datago: 'OLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLDOLD' };
  const registry = { getKey: (n) => store[n] || null, saveKey: (n, k) => { store[n] = k; } };
  const s = createServer({});
  registerApplyTools(s, { apply: mkApply({ encoding: FAKE2, decoding: decodeURIComponent(FAKE2) }), registry });
  const res = await s.handle(call('apply_get_key', {}, 'o'), {});
  assert.equal(res.result.structuredContent.keyName, 'datago-2');
  assert.equal(store.datago.startsWith('OLD'), true);
  assert.equal(store['datago-2'], FAKE2);
  assert.ok(!JSON.stringify(res.result).includes('EXAMPLE'));
  assert.ok(!JSON.stringify(res.result).includes('OLDOLDOLDOLDOLD'));
  // 같은 키를 다시 읽으면 중복 저장하지 않음
  const again = await s.handle(call('apply_get_key', {}, 'o2'), {});
  assert.equal(again.result.structuredContent.saved, false);
  assert.equal(Object.keys(store).length, 2);
});
