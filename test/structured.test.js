process.env.DATAGO_ALLOW_LOCAL = '1';
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/mcp.js';
import { createRegistry } from '../src/registry.js';
import { createUsage } from '../src/usage.js';
import { registerTools } from '../src/tools.js';
import { OUTPUT_SCHEMAS, structured } from '../src/outputs.js';

// 테스트용 최소 JSON Schema 검사기 (type / required / properties / items 만)
function validate(schema, v, at = '$') {
  const types = [].concat(schema.type || []);
  const tn = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
  if (types.length && !types.includes(tn)) throw new Error(`${at}: ${tn} not in ${types}`);
  if (tn === 'object') {
    for (const r of schema.required || []) if (!(r in v)) throw new Error(`${at}.${r} 누락`);
    for (const [k, sub] of Object.entries(schema.properties || {})) if (k in v) validate(sub, v[k], `${at}.${k}`);
  }
}

const tmp = (n) => path.join(os.tmpdir(), `struct-${n}-never.json`);
const okFetch = (total = 3) => async () => ({
  ok: true, status: 200, headers: { get: () => 'application/json' },
  text: async () => JSON.stringify({ response: { header: { resultCode: '00' }, body: { totalCount: total, items: { item: [{ a: 1 }, { a: 2 }] } } } }),
});

function setup(extra = {}) {
  const s = createServer({});
  registerTools(s, { registry: createRegistry(tmp('r')), usage: createUsage(tmp('u')), fetchImpl: okFetch(), sleep: async () => {}, ...extra });
  return s;
}
const call = (s, name, args) => s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

test('outputSchema 가 tools/list 에 노출된다', async () => {
  const res = await setup().handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  for (const n of Object.keys(OUTPUT_SCHEMAS).filter((k) => !k.startsWith('apply_') && k !== 'use_api')) {
    assert.ok(res.result.tools.find((t) => t.name === n)?.outputSchema, n);
  }
});

test('call_api / fetch_all / quota_status / list_keys 의 structuredContent 가 스키마를 만족하고 text 와 일치', async () => {
  const s = setup();
  const cases = [
    ['call_api', { url: 'https://apis.data.go.kr/x', serviceKey: 'k' }],
    ['call_api', { url: 'https://apis.data.go.kr/x', serviceKey: 'k', itemsOnly: true }],
    ['fetch_all', { url: 'https://apis.data.go.kr/x', serviceKey: 'k', maxPages: 1 }],
    ['quota_status', {}],
    ['list_keys', {}],
  ];
  for (const [name, args] of cases) {
    const r = (await call(s, name, args)).result;
    assert.ok(!r.isError, `${name}: ${r.content?.[0]?.text}`);
    assert.ok(r.structuredContent, name);
    validate(OUTPUT_SCHEMAS[name], r.structuredContent, name);
    assert.deepEqual(JSON.parse(r.content[0].text), r.structuredContent, name);
  }
});

test('큰 응답이 잘려도 structuredContent 는 스키마를 만족한다', async () => {
  const big = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: { item: [{ v: 'x'.repeat(30000) }] } } } }) });
  const r = (await call(setup({ fetchImpl: big }), 'call_api', { url: 'https://apis.data.go.kr/x', serviceKey: 'k' })).result;
  assert.match(r.content[0].text, /생략/);
  validate(OUTPUT_SCHEMAS.call_api, r.structuredContent);
  assert.equal(r.structuredContent.truncated, true);
});

test('structured() 헬퍼', () => {
  const r = structured({ a: 1 });
  assert.deepEqual(r.structuredContent, { a: 1 });
  assert.equal(r.content[0].type, 'text');
});

test('export_data 빈 결과도 structuredContent 를 준다', async () => {
  const empty = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({ response: { header: { resultCode: '00' }, body: { totalCount: 0, items: '' } } }) });
  const s = setup({ fetchImpl: empty });
  const r = (await call(s, 'export_data', { url: 'https://apis.data.go.kr/x', serviceKey: 'k' })).result;
  assert.ok(r.structuredContent, JSON.stringify(r));
  assert.equal(r.structuredContent.rows, 0);
  validate(OUTPUT_SCHEMAS.export_data, r.structuredContent, 'export_data');
});

test('call_api 는 method 인자를 받지 않는다', async () => {
  const res = await setup().handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const t = res.result.tools.find((x) => x.name === 'call_api');
  assert.equal(t.inputSchema.properties.method, undefined);
});
