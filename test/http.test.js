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
