// describe_api / search_datasets / find_apply_targets 도구 계층: 레이아웃 변형과 오류 안내 (fixture 기반, 네트워크 없음)
process.env.DATAGO_ALLOW_LOCAL = '1';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/mcp.js';
import { createRegistry } from '../src/registry.js';
import { registerTools } from '../src/tools.js';

const read = (n) => fs.readFileSync(new URL(`./fixtures/real/${n}`, import.meta.url), 'utf8');
const reply = (body, status = 200) => ({ ok: status < 400, status, text: async () => body });

async function call(fetchImpl, name, args) {
  const s = createServer();
  registerTools(s, { registry: createRegistry(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'datago-')), 'c.json')), fetchImpl });
  const res = await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  return { res: res.result, out: res.result.structuredContent ?? JSON.parse(res.result.content[0].text) };
}

test('describe_api: operation 인자로 다른 기능의 요청주소를 돌려준다', async () => {
  const fetchImpl = async (url) => reply(url.includes('selectApiDetailFunction') ? read('operation-fragment.html') : read('openapi-spcde.html'));
  const { out } = await call(fetchImpl, 'describe_api', { idOrUrl: '15012690', operation: '24868' });
  assert.equal(out.operation, '공휴일 정보 조회');
  assert.match(out.endpoint, /getRestDeInfo$/);
  assert.equal(out.note, undefined);
});

test('describe_api: 기능이 여러 개인데 operation 이 없으면 operation 사용법을 안내', async () => {
  const { out } = await call(async () => reply(read('openapi-spcde.html')), 'describe_api', { idOrUrl: '15012690' });
  assert.match(out.note, /operation/);
});

test('describe_api: LINK/비REST 페이지는 reason=not_rest 와 영어 hint', async () => {
  const link = '<title>링크형 데이터 | 공공데이터포털</title><strong class="key">API 유형</strong><div class="value">LINK</div>';
  const { out } = await call(async () => reply(link), 'describe_api', { idOrUrl: '15099999' });
  assert.equal(out.found, false);
  assert.equal(out.reason, 'not_rest');
  assert.match(out.message, /REST/);
  assert.match(out.hint, /Not a REST/);
});

test('describe_api: 필드가 일부 없어도(요청변수 표 없음) 죽지 않고 안내', async () => {
  const partial = '<title>부분 | 공공데이터포털</title><strong class="key">요청주소</strong><div class="value">https://apis.data.go.kr/x/y</div>';
  const { out } = await call(async () => reply(partial), 'describe_api', { idOrUrl: '15099998' });
  assert.equal(out.endpoint, 'https://apis.data.go.kr/x/y');
  assert.deepEqual(out.request, []);
});

test('search_datasets: 0건 / 오류는 message + hint 구조로', async () => {
  let r = await call(async () => reply(read('search-empty.html')), 'search_datasets', { query: 'zzz' });
  assert.equal(r.out.count, 0);
  assert.match(r.out.message, /검색 결과가 없어요/);
  assert.match(r.out.hint, /shorter/);
  r = await call(async () => reply('x', 503), 'search_datasets', { query: '날씨' });
  assert.match(r.out.message, /503/);
  assert.ok(r.out.hint);
  r = await call(async () => reply(read('search-real.html')), 'search_datasets', { query: '미세먼지' });
  assert.equal(r.out.count, 10);
  assert.equal(r.out.total, 916);
});

test('find_apply_targets: 결과 없음은 구조화된 안내', async () => {
  const { out } = await call(async () => reply(read('search-empty.html')), 'find_apply_targets', { keyword: 'zzz' });
  assert.equal(out.count, 0);
  assert.match(out.message, /검색 결과가 없어요/);
  assert.ok(out.hint);
});

// ── call_api 호출 전 검증 ──
function mkServer(fetchImpl) {
  const s = createServer();
  const reg = createRegistry(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'datago-')), 'c.json'));
  reg.saveKey('k', 'k'.repeat(40));
  registerTools(s, { registry: reg, fetchImpl });
  const run = async (name, args) => (await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).result;
  return { run, reg };
}

test('call_api: describe_api 로 명세를 본 뒤 필수 변수가 빠지면 호출하지 않는다', async () => {
  let apiCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes('data.go.kr/data/')) return reply(read('openapi-spcde.html'));
    apiCalls++;
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '{"response":{"header":{"resultCode":"00"},"body":{"items":{"item":[]}}}}' };
  };
  const { run } = mkServer(fetchImpl);
  const d = JSON.parse((await run('describe_api', { idOrUrl: '15012690' })).content[0].text);
  const url = d.endpoint;
  const r = (await run('call_api', { url, params: { solYear: '2026' } })).structuredContent.summary;
  assert.equal(r.skipped, true);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['pageNo', 'numOfRows']);
  assert.match(r.message, /필수 요청변수/);
  assert.match(r.hint, /skipValidation/);
  assert.equal(apiCalls, 0);
  // 모두 채우면 호출, 오타 변수는 warnings
  const ok = (await run('call_api', { url, params: { solYear: '2026', pageNo: 1, numOfRows: 10, sollYear: 1 } })).structuredContent.summary;
  assert.equal(ok.ok, true);
  assert.match(ok.warnings[0], /sollYear/);
  assert.equal(apiCalls, 1);
  // skipValidation 은 그대로 호출
  await run('call_api', { url, params: {}, skipValidation: true });
  assert.equal(apiCalls, 2);
});

test('call_api: params 안의 serviceKey 는 한 번만 붙는다, 별칭 저장 시 필수 변수 영속', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    if (String(url).includes('data.go.kr/data/')) return reply(read('openapi-spcde.html'));
    seen.push(String(url));
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '{"resultCode":"00"}' };
  };
  const { run, reg } = mkServer(fetchImpl);
  await run('describe_api', { idOrUrl: '15012690', saveAs: 'sp' });
  assert.deepEqual(reg.getEndpoint('sp').required, ['pageNo', 'numOfRows', 'solYear']);
  const r = (await run('call_api', { endpoint: 'sp', params: { solYear: 2026 } })).structuredContent.summary;
  assert.equal(r.skipped, true);
  await run('call_api', { url: 'https://apis.data.go.kr/a/b', params: { serviceKey: 'z'.repeat(30), q: '한글' } });
  assert.equal(seen[0].match(/serviceKey=/g).length, 1);
  assert.ok(seen[0].includes('serviceKey=' + 'z'.repeat(30)));
});

test('fetch_all: 필수 변수 누락은 오류(hint 포함)로 중단', async () => {
  const fetchImpl = async (url) => reply(read('openapi-spcde.html'));
  const { run } = mkServer(fetchImpl);
  const d = JSON.parse((await run('describe_api', { idOrUrl: '15012690' })).content[0].text);
  const res = await run('fetch_all', { url: d.endpoint, params: {} });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /solYear/);
});
