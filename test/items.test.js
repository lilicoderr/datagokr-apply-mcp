import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { extractItems, hasMore } from '../src/items.js';
import { parseXml } from '../src/xml.js';
import { createUsage, kstDate } from '../src/usage.js';
import { createServer } from '../src/mcp.js';
import { createRegistry } from '../src/registry.js';
import { registerTools } from '../src/tools.js';

const tmp = (n) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'datago-')), n);

test('extractItems: JSON items.item 배열', () => {
  const data = { response: { header: { resultCode: '00' }, body: { items: { item: [{ a: 1 }, { a: 2 }] }, totalCount: 2, pageNo: 1, numOfRows: 10 } } };
  const r = extractItems(data);
  assert.equal(r.items.length, 2);
  assert.equal(r.totalCount, 2);
  assert.equal(r.numOfRows, 10);
});

test('extractItems: 단일 객체/빈 문자열/직접 배열', () => {
  assert.equal(extractItems({ response: { body: { items: { item: { a: 1 } } } } }).items.length, 1);
  assert.equal(extractItems({ response: { body: { items: '' } } }).items.length, 0);
  assert.equal(extractItems({ body: { items: [{ x: 1 }, { x: 2 }, { x: 3 }] } }).items.length, 3);
  assert.deepEqual(extractItems(null).items, []);
});

test('extractItems: XML 파싱 결과도 동일하게', () => {
  const xml = '<response><header><resultCode>00</resultCode></header><body><items><item><n>a</n></item><item><n>b</n></item></items><numOfRows>10</numOfRows><pageNo>1</pageNo><totalCount>25</totalCount></body></response>';
  const r = extractItems(parseXml(xml));
  assert.equal(r.items.length, 2);
  assert.equal(r.totalCount, 25);
  assert.equal(r.pageNo, 1);
});

test('hasMore: totalCount 기준', () => {
  assert.equal(hasMore({ totalCount: 25, pageNo: 1, numOfRows: 10, items: new Array(10) }), true);
  assert.equal(hasMore({ totalCount: 25, pageNo: 3, numOfRows: 10, items: new Array(5) }), false);
  assert.equal(hasMore({ totalCount: null, pageNo: 1, numOfRows: 10, items: new Array(10) }), true);
  assert.equal(hasMore({ totalCount: null, pageNo: 1, numOfRows: 10, items: new Array(3) }), false);
});

test('usage: KST 날짜 경계와 집계', () => {
  assert.equal(kstDate(new Date('2026-05-01T14:59:00Z')), '2026-05-01'); // KST 23:59
  assert.equal(kstDate(new Date('2026-05-01T15:00:00Z')), '2026-05-02'); // KST 자정 넘김
  let t = new Date('2026-05-01T03:00:00Z');
  const u = createUsage(tmp('u.json'), { now: () => t });
  u.record('main'); u.record('main', { ok: false }); u.record('sub');
  const s = u.summary({ limit: 10 });
  assert.equal(s.total, 3);
  assert.equal(s.byKey.main.calls, 2);
  assert.equal(s.byKey.main.failed, 1);
  assert.equal(s.byKey.main.remaining, 8);
  t = new Date('2026-05-02T03:00:00Z'); // 다음 날은 0부터
  assert.equal(u.summary().total, 0);
});

test('usage: 80% 도달 시 warn, 오래된 날짜 정리, 손상된 파일 무시', () => {
  const f = tmp('u.json');
  fs.writeFileSync(f, '{깨진');
  const u = createUsage(f, { now: () => new Date('2026-05-01T03:00:00Z') });
  for (let i = 0; i < 8; i++) u.record('k');
  assert.equal(u.summary({ limit: 10 }).byKey.k.warn, true);
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(Object.keys(raw).length, 1);
});

function mockFetch(pages) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const pageNo = Number(new URL(url).searchParams.get('pageNo') || 1);
    const body = pages[pageNo - 1];
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) };
  };
  fn.calls = calls;
  return fn;
}
const page = (items, pageNo, total) => ({ response: { header: { resultCode: '00' }, body: { items: { item: items }, pageNo, numOfRows: 2, totalCount: total } } });
const callTool = (s, name, args) => s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

test('fetch_all: 페이지를 순회해 합치고 사용량 기록', async () => {
  const fetchImpl = mockFetch([page([{ i: 1 }, { i: 2 }], 1, 5), page([{ i: 3 }, { i: 4 }], 2, 5), page([{ i: 5 }], 3, 5)]);
  const usage = createUsage(tmp('u.json'));
  const s = createServer();
  const reg = createRegistry(tmp('c.json'));
  reg.saveKey('k', 'plainkey0123456789');
  registerTools(s, { registry: reg, fetchImpl, usage, sleep: async () => {} });
  const res = await callTool(s, 'fetch_all', { url: 'http://x/api', numOfRows: 2 });
  const out = JSON.parse(res.result.content[0].text);
  assert.equal(out.조회페이지, 3);
  assert.equal(out.가져온항목수, 5);
  assert.equal(out.잘림, false);
  assert.equal(fetchImpl.calls.length, 3);
  assert.equal(usage.summary().total, 3);
});

test('fetch_all: maxPages 로 상한, 잘림 표시', async () => {
  const fetchImpl = mockFetch([page([{ i: 1 }, { i: 2 }], 1, 99), page([{ i: 3 }, { i: 4 }], 2, 99)]);
  const s = createServer();
  const reg = createRegistry(tmp('c.json'));
  reg.saveKey('k', 'plainkey0123456789');
  registerTools(s, { registry: reg, fetchImpl, sleep: async () => {} });
  const out = JSON.parse((await callTool(s, 'fetch_all', { url: 'http://x', numOfRows: 2, maxPages: 2 })).result.content[0].text);
  assert.equal(out.조회페이지, 2);
  assert.equal(out.잘림, true);
});

test('call_api itemsOnly: 항목만 간추려 반환', async () => {
  const fetchImpl = mockFetch([page([{ i: 1 }, { i: 2 }, { i: 3 }], 1, 3)]);
  const s = createServer();
  const reg = createRegistry(tmp('c.json'));
  reg.saveKey('k', 'plainkey0123456789');
  registerTools(s, { registry: reg, fetchImpl });
  const out = JSON.parse((await callTool(s, 'call_api', { url: 'http://x', itemsOnly: true, maxItems: 2 })).result.content[0].text);
  assert.equal(out.항목수, 3);
  assert.equal(out.항목.length, 2);
  assert.equal(out.생략됨, 1);
  assert.equal(out.페이징.totalCount, 3);
});

test('quota_status 도구', async () => {
  const usage = createUsage(tmp('u.json'));
  usage.record('main');
  const s = createServer();
  registerTools(s, { registry: createRegistry(tmp('c.json')), usage });
  const out = JSON.parse((await callTool(s, 'quota_status', { limit: 100 })).result.content[0].text);
  assert.equal(out.byKey.main.remaining, 99);
});

test('call_api: 없는 keyName 이면 안내 메시지', async () => {
  const s = createServer();
  registerTools(s, { registry: createRegistry(tmp('c.json')) });
  const res = await callTool(s, 'call_api', { url: 'http://x', keyName: 'nope' });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /list_keys/);
});
