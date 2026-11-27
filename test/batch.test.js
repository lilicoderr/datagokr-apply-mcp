import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from '../src/mcp.js';
import { createRegistry } from '../src/registry.js';
import { createUsage } from '../src/usage.js';
import { registerTools } from '../src/tools.js';

const tmp = (n) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'datago-')), n);
const html = fs.readFileSync(new URL('./fixtures/openapi-detail.html', import.meta.url), 'utf8');
const okBody = (n) => ({ response: { header: { resultCode: '00' }, body: { items: { item: Array.from({ length: n }, (_, i) => ({ i })) }, totalCount: n } } });
const errBody = { response: { header: { resultCode: '22', resultMsg: 'LIMITED' } } };

function setup(handler) {
  const s = createServer();
  const reg = createRegistry(tmp('c.json'));
  reg.saveKey('k', 'plainkey0123456789');
  const usage = createUsage(tmp('u.json'));
  const calls = [];
  const sleeps = [];
  const fetchImpl = async (url) => {
    calls.push(new URL(url).searchParams.get('q'));
    const body = handler(calls.length);
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) };
  };
  registerTools(s, { registry: reg, fetchImpl, usage, sleep: async (ms) => { sleeps.push(ms); } });
  return { s, calls, sleeps, usage };
}
const run = async (s, name, args) => JSON.parse((await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).result.content[0].text);

test('batch_call: 각 params 를 순서대로 호출하고 사이에 대기', async () => {
  const { s, calls, sleeps, usage } = setup(() => okBody(2));
  const out = await run(s, 'batch_call', { url: 'http://x', params: { z: 1 }, paramsList: [{ q: 'a' }, { q: 'b' }, { q: 'c' }], intervalMs: 50 });
  assert.deepEqual(calls, ['a', 'b', 'c']);
  assert.deepEqual(sleeps.filter((m) => m === 50), [50, 50]);
  assert.equal(out.성공, 3);
  assert.equal(out.결과[0].항목수, 2);
  assert.equal(usage.summary().total, 3);
});

test('batch_call: 실패는 집계하고 stopOnError 면 중단', async () => {
  const mk = () => setup((n) => (n === 2 ? errBody : okBody(1)));
  const a = mk();
  const all = await run(a.s, 'batch_call', { url: 'http://x', paramsList: [{ q: 1 }, { q: 2 }, { q: 3 }] });
  assert.equal(all.실행, 3);
  assert.equal(all.실패, 1);
  assert.equal(all.결과[1].ok, false);
  const b = mk();
  const stop = await run(b.s, 'batch_call', { url: 'http://x', paramsList: [{ q: 1 }, { q: 2 }, { q: 3 }], stopOnError: true });
  assert.equal(stop.실행, 2);
});

test('batch_call: 50건 상한, 빈 목록은 오류', async () => {
  const { s, calls } = setup(() => okBody(0));
  await run(s, 'batch_call', { url: 'http://x', paramsList: Array.from({ length: 80 }, (_, i) => ({ q: i })), intervalMs: 0 });
  assert.equal(calls.length, 50);
  const res = await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'batch_call', arguments: { url: 'http://x', paramsList: [] } } });
  assert.equal(res.result.isError, true);
});

test('api_types: 명세 페이지에서 TypeScript 인터페이스 생성', async () => {
  const s = createServer();
  registerTools(s, { registry: createRegistry(tmp('c.json')), fetchImpl: async () => ({ ok: true, status: 200, text: async () => html }) });
  const res = await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'api_types', arguments: { idOrUrl: '15012690', name: 'holiday' } } });
  const t = res.result.content[0].text;
  assert.match(t, /export interface HolidayParams/);
  assert.match(t, /export interface HolidayItem/);
  assert.match(t, /export interface HolidayResponse/);
});

test('api_types: 파싱 불가 페이지는 안내 문구', async () => {
  const s = createServer();
  registerTools(s, { registry: createRegistry(tmp('c.json')), fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<title>x | y</title>' }) });
  const res = await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'api_types', arguments: { idOrUrl: '15099999' } } });
  assert.match(res.result.content[0].text, /읽지 못했어요/);
});
