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

test('apply_apis 가 항목마다 진행률을 보낸다', async () => {
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
  await s.handle(call('apply_apis', { ids: ['15000314', '15057552'] }, 'a'), { notify: (m) => got.push(m) });
  assert.deepEqual(got.map((m) => m.params.progress), [1, 2]);
  assert.match(got[1].params.message, /2\/2/);
});
