// call_api/fetch_all/export_data 검토 회귀 테스트 (가짜 키).
process.env.DATAGO_ALLOW_LOCAL = '1';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/mcp.js';
import { createRegistry } from '../src/registry.js';
import { createCache } from '../src/cache.js';
import { registerTools } from '../src/tools.js';
import { safeFileName } from '../src/export.js';

const page = (code, items, total) => ({ ok: true, status: 200, headers: { get: () => 'application/json' },
  text: async () => JSON.stringify({ response: { header: { resultCode: code }, body: { items: { item: items }, totalCount: total } } }) });

function server(fetchImpl, extra = {}) {
  const reg = createRegistry(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'datago-st-')), 'c.json'));
  reg.saveKey('main', 'FAKEmainkey0123456789');
  const s = createServer();
  registerTools(s, { registry: reg, fetchImpl, sleep: async () => {}, ...extra });
  const call = async (name, args) => (await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).result;
  return { s, call };
}

test('a directly passed key is not cached or counted under the default key name', async () => {
  let fetched = 0;
  const names = [];
  const { call } = server(async () => { fetched++; return page('00', [{ a: 1 }], 1); },
    { cache: createCache(), usage: { record: (n) => names.push(n) } });
  await call('call_api', { url: 'http://x/api', cacheSeconds: 60 });
  await call('call_api', { url: 'http://x/api', cacheSeconds: 60, serviceKey: 'FAKEotherkey0123456789' });
  assert.equal(fetched, 2);
  assert.deepEqual(names, ['main', 'direct']);
});

test('every argument the handlers read is declared (skipValidation)', () => {
  const { s } = server(async () => page('00', [], 0));
  for (const n of ['call_api', 'fetch_all', 'export_data']) assert.ok(s.tools.get(n).def.inputSchema.properties.skipValidation, n);
});

test('a failure after the first page marks the result truncated', async () => {
  let n = 0;
  const { call } = server(async () => (++n === 1 ? page('00', [{ a: 1 }, { a: 2 }]) : page('22', [])));
  const r = await call('fetch_all', { url: 'http://x/api', numOfRows: 2 });
  assert.equal(r.structuredContent.count, 2);
  assert.equal(r.structuredContent.truncated, true);
});

test('Windows superscript device names are escaped', () => {
  assert.equal(safeFileName('COM¹', 'csv'), '_COM¹.csv');
  assert.equal(safeFileName('lpt³.data.x', 'json'), '_lpt³.data.json');
});
