import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/mcp.js';
import { startHttp, assertBindable } from '../src/http.js';

async function boot(token) {
  const s = createServer({ name: 't', version: '1' });
  s.tool('hi', { description: 'x' }, async () => 'hello');
  const srv = await startHttp(s, { port: 0, token });
  return { srv, url: `http://127.0.0.1:${srv.address().port}/mcp` };
}
const rpc = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, params });

test('POST tools/call over HTTP', async () => {
  const { srv, url } = await boot('');
  try {
    const r = await fetch(url, { method: 'POST', body: rpc(1, 'tools/call', { name: 'hi' }) });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).result.content[0].text, 'hello');
  } finally { srv.close(); }
});

test('notification returns 202, GET 405, bad JSON 400, wrong path 404', async () => {
  const { srv, url } = await boot('');
  try {
    let r = await fetch(url, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    assert.equal(r.status, 202);
    assert.equal((await fetch(url)).status, 405);
    assert.equal((await fetch(url, { method: 'POST', body: '{' })).status, 400);
    assert.equal((await fetch(url.replace('/mcp', '/x'), { method: 'POST', body: '{}' })).status, 404);
  } finally { srv.close(); }
});

test('token auth required when configured', async () => {
  const { srv, url } = await boot('s3cret');
  try {
    assert.equal((await fetch(url, { method: 'POST', body: rpc(1, 'ping') })).status, 401);
    const bad = await fetch(url, { method: 'POST', body: rpc(1, 'ping'), headers: { authorization: 'Bearer nope' } });
    assert.equal(bad.status, 401);
    const ok = await fetch(url, { method: 'POST', body: rpc(1, 'ping'), headers: { authorization: 'Bearer s3cret' } });
    assert.equal(ok.status, 200);
  } finally { srv.close(); }
});

test('foreign Origin rejected; batch supported', async () => {
  const { srv, url } = await boot('');
  try {
    const bad = await fetch(url, { method: 'POST', body: rpc(1, 'ping'), headers: { origin: 'https://evil.example' } });
    assert.equal(bad.status, 403);
    const b = await fetch(url, { method: 'POST', body: `[${rpc(1, 'ping')},${rpc(2, 'ping')}]` });
    assert.equal((await b.json()).length, 2);
  } finally { srv.close(); }
});

test('non-local bind requires token', () => {
  assert.throws(() => assertBindable('0.0.0.0', ''), /DATAGO_HTTP_TOKEN/);
  assert.doesNotThrow(() => assertBindable('0.0.0.0', 'x'));
  assert.doesNotThrow(() => assertBindable('127.0.0.1', ''));
});

test('SSE: progressToken + Accept 이면 진행률 이벤트 뒤 최종 응답', async () => {
  const s = createServer({ name: 't', version: '1' });
  s.tool('work', { description: 'x' }, async (_a, ctx) => { ctx.progress(1, 2, 'half'); ctx.progress(2, 2); return 'done'; });
  const srv = await startHttp(s, { port: 0 });
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/mcp`, {
      method: 'POST', headers: { accept: 'application/json, text/event-stream' },
      body: rpc(1, 'tools/call', { name: 'work', _meta: { progressToken: 'p' } }),
    });
    assert.match(r.headers.get('content-type'), /text\/event-stream/);
    const events = (await r.text()).split('\n\n').filter(Boolean).map((e) => JSON.parse(e.replace(/^event: message\ndata: /, '')));
    assert.deepEqual(events.map((e) => e.method || 'result'), ['notifications/progress', 'notifications/progress', 'result']);
    assert.equal(events[2].result.content[0].text, 'done');
  } finally { srv.close(); }
});

test('클라이언트가 연결을 끊으면 진행 중 도구가 취소된다', async () => {
  const s = createServer({ name: 't', version: '1' });
  let aborted;
  const seen = new Promise((res) => { aborted = res; });
  s.tool('hang', { description: 'x' }, (_a, ctx) => new Promise(() => { ctx.signal.addEventListener('abort', () => aborted(true)); }));
  const srv = await startHttp(s, { port: 0 });
  try {
    const ac = new AbortController();
    fetch(`http://127.0.0.1:${srv.address().port}/mcp`, { method: 'POST', body: rpc(3, 'tools/call', { name: 'hang' }), signal: ac.signal }).catch(() => {});
    await new Promise((r) => setTimeout(r, 50));
    ac.abort();
    assert.equal(await Promise.race([seen, new Promise((r) => setTimeout(() => r('timeout'), 2000))]), true);
  } finally { srv.close(); srv.closeAllConnections?.(); }
});
