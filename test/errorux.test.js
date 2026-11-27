// 오류 UX: 모든 실패 경로가 한국어 message + 영어 hint 를 갖는다
process.env.DATAGO_ALLOW_LOCAL = '1';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/mcp.js';
import { createRegistry } from '../src/registry.js';
import { registerTools } from '../src/tools.js';
import { hintForError } from '../src/errorhints.js';
import { CircuitOpenError } from '../src/breaker.js';

function mk(fetchImpl = async () => { throw new Error('no network'); }) {
  const s = createServer();
  registerTools(s, { registry: createRegistry(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'datago-')), 'c.json')), fetchImpl });
  return (name, args) => s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }).then((r) => r.result);
}

test('throw 된 오류는 text 에 hint 줄, structuredContent{ok,error,hint}', async () => {
  const run = mk();
  const cases = [
    ['call_api', { url: 'https://apis.data.go.kr/x' }, /No service key/],
    ['call_api', { endpoint: '없는별칭' }, /alias/],
    ['call_api', {}, /url/i],
    ['call_api', { url: 'not a url', serviceKey: 'k'.repeat(20) }, /Malformed|Blocked/],
    ['save_key', { name: 'a', key: 'short' }, /Invalid key/],
    ['export_data', { url: 'https://apis.data.go.kr/x', serviceKey: 'k'.repeat(20), format: 'xlsx' }, /csv/],
  ];
  for (const [name, args, re] of cases) {
    const r = await run(name, args);
    assert.equal(r.isError, true, name);
    assert.match(r.content[0].text, /^오류: /);
    assert.match(r.content[0].text, /\nhint: /);
    assert.equal(r.structuredContent.ok, false);
    assert.match(r.structuredContent.hint, re, `${name}: ${r.structuredContent.hint}`);
  }
});

test('hintForError: 객체 hint 우선, 차단기/기본값', () => {
  assert.equal(hintForError(Object.assign(new Error('x'), { hint: 'H' })), 'H');
  assert.match(hintForError(new CircuitOpenError('h', 5000)), /Circuit breaker/);
  assert.match(hintForError(new Error('알 수 없는')), /doctor/);
});

test('call_api 실패 요약: hint(영어) + advice(한국어)', async () => {
  const run = mk(async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' },
    text: async () => '{"response":{"header":{"resultCode":"22","resultMsg":"LIMIT"}}}' }));
  const r = await run('call_api', { url: 'https://apis.data.go.kr/x', serviceKey: 'k'.repeat(20) });
  assert.match(r.structuredContent.summary.hint, /Daily traffic/);
  assert.match(r.structuredContent.summary.advice, /트래픽/);
});
