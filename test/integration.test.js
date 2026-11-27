// 오프라인 통합 테스트: 로컬 HTTP 서버가 fixture 응답을 돌려주고,
// 실제 fetch + registerTools 전체 경로(키 부착 → 호출 → 해석 → 파일 저장)를 검증한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/mcp.js';
import { createRegistry } from '../src/registry.js';
import { registerTools } from '../src/tools.js';

const fx = (n) => fs.readFileSync(new URL(`./fixtures/api/${n}`, import.meta.url), 'utf8');
process.env.DATAGO_ALLOW_LOCAL = '1'; // 로컬 fixture 서버 허용
const KEY = 'TESTKEY0123456789abcdefTESTKEY0123456789==';

async function withEnv(fn) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    seen.push(u.pathname + u.search);
    const send = (type, body, code = 200) => { res.writeHead(code, { 'content-type': type }); res.end(body); };
    if (u.pathname === '/list') return send('application/json', fx(`list-p${u.searchParams.get('pageNo') || 1}.json`));
    if (u.pathname === '/xml') return send('application/xml', fx('list.xml'));
    if (u.pathname === '/badkey') return send('application/xml', fx('error-30.xml'));
    if (u.pathname === '/quota') return send('application/json', fx('quota-22.json'));
    send('text/plain', 'nope', 404);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'datago-int-'));
  const registry = createRegistry(path.join(dir, 'c.json'));
  registry.saveKey('main', KEY);
  const server = createServer({ name: 't' });
  registerTools(server, { registry, exportDir: path.join(dir, 'out'), sleep: async () => {} });
  const call = async (name, args) => {
    const r = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    return r.result;
  };
  try { await fn({ base, call, dir, seen }); } finally { srv.close(); }
}

test('call_api: JSON 응답 해석 + 키 자동 부착', () => withEnv(async ({ base, call, seen }) => {
  const r = await call('call_api', { url: `${base}/list`, params: { pageNo: 1, numOfRows: 3 }, itemsOnly: true });
  const out = JSON.parse(r.content[0].text);
  assert.equal(out.요약.ok, true);
  assert.equal(out.항목수, 3);
  assert.equal(out.페이징.totalCount, 7);
  assert.match(seen[0], /serviceKey=/);
}));

test('call_api: XML 응답도 같은 형태로', () => withEnv(async ({ base, call }) => {
  const r = await call('call_api', { url: `${base}/xml`, itemsOnly: true });
  const out = JSON.parse(r.content[0].text);
  assert.equal(out.요약.응답형식, 'xml');
  assert.equal(out.항목[0].name, '가');
}));

test('call_api: 쿼터 초과(22) 는 의미와 함께 실패로', () => withEnv(async ({ base, call }) => {
  const out = JSON.parse((await call('call_api', { url: `${base}/quota` })).content[0].text);
  assert.equal(out.요약.ok, false);
  assert.equal(out.요약.resultCode, '22');
}));

test('call_api: 키 미등록(30) 은 반대 인코딩으로 재시도하고 실패 보고', () => withEnv(async ({ base, call, seen }) => {
  const out = JSON.parse((await call('call_api', { url: `${base}/badkey` })).content[0].text);
  assert.equal(out.요약.ok, false);
  assert.equal(out.요약.재시도됨, true);
  assert.equal(seen.length, 2);
}));

test('fetch_all: 3페이지 순회로 7건 수집', () => withEnv(async ({ base, call }) => {
  const r = await call('fetch_all', { url: `${base}/list`, numOfRows: 3, maxPages: 5 });
  assert.match(r.content[0].text, /7/);
}));

test('export_data: CSV 파일 저장, 키는 파일에 없음', () => withEnv(async ({ base, call, dir }) => {
  const r = await call('export_data', { url: `${base}/list`, numOfRows: 3, maxPages: 5, filename: 'fx' });
  assert.ok(!r.isError, r.content[0].text);
  const f = path.join(dir, 'out', 'fx.csv');
  const csv = fs.readFileSync(f, 'utf8');
  assert.equal(csv.trim().split('\n').length, 8);
  assert.ok(!csv.includes(KEY));
}));
