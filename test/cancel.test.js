import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/mcp.js';
import { callApi } from '../src/datago.js';

const call = (id, name) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: {} } });

test('notifications/cancelled 는 진행 중 요청을 중단하고 응답을 보내지 않는다', async () => {
  const s = createServer({});
  let sawAbort = false;
  s.tool('slow', { description: 'x' }, (_a, ctx) => new Promise((res) => {
    ctx.signal.addEventListener('abort', () => { sawAbort = true; });
    setTimeout(() => res('late'), 2000).unref();
  }));
  const p = s.handle(call(5, 'slow'));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(await s.handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 5, reason: 'user' } }), null);
  assert.equal(await p, null);
  assert.equal(sawAbort, true);
});

test('취소 알림은 다른 요청/없는 id 에 영향 없다', async () => {
  const s = createServer({});
  s.tool('fast', { description: 'x' }, async () => 'ok');
  await s.handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 999 } });
  const r = await s.handle(call(1, 'fast'));
  assert.equal(r.result.content[0].text, 'ok');
});

test('callApi: 이미 취소된 signal 은 즉시 거부, 진행 중 취소는 재시도 없이 중단', async () => {
  const pre = new AbortController(); pre.abort(new Error('cancelled'));
  await assert.rejects(callApi({ url: 'https://apis.data.go.kr/x', serviceKey: 'k', signal: pre.signal, fetchImpl: async () => { throw new Error('no'); } }), /cancelled/);
  const ctrl = new AbortController();
  let calls = 0;
  const fetchImpl = (u, { signal }) => new Promise((_, rej) => {
    calls += 1;
    signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const p = callApi({ url: 'https://apis.data.go.kr/x', serviceKey: 'k', fetchImpl, signal: ctrl.signal, sleep: async () => {} });
  setTimeout(() => ctrl.abort(new Error('user cancel')), 10);
  await assert.rejects(p, /user cancel/);
  assert.equal(calls, 1);
});

test('fetch_all 은 취소되면 다음 페이지를 요청하지 않는다', async () => {
  const { registerTools } = await import('../src/tools.js');
  const { createRegistry } = await import('../src/registry.js');
  const os = await import('node:os'); const path = await import('node:path');
  const s = createServer({});
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    const body = JSON.stringify({ response: { header: { resultCode: '00' }, body: { totalCount: 99, items: { item: [{ a: n }] } } } });
    return { ok: true, status: 200, text: async () => body, headers: { get: () => 'application/json' } };
  };
  registerTools(s, { registry: createRegistry(path.join(os.tmpdir(), 'cancel-never.json')), fetchImpl, sleep: async () => {} });
  const p = s.handle({ jsonrpc: '2.0', id: 9, method: 'tools/call',
    params: { name: 'fetch_all', arguments: { url: 'https://apis.data.go.kr/x', serviceKey: 'k', numOfRows: 1, maxPages: 50 }, _meta: { progressToken: 't' } } },
  { notify: (m) => { if (m.params.progress === 2) s.handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 9 } }); } });
  assert.equal(await p, null);
  assert.ok(n <= 3, `요청 수 ${n}`);
});
