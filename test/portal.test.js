import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOpenApiPage, buildExampleParams, cleanText, fetchApiSpec } from '../src/portal.js';

const html = fs.readFileSync(new URL('./fixtures/openapi-detail.html', import.meta.url), 'utf8');

test('cleanText: 태그/엔티티/공백 정리', () => {
  assert.equal(cleanText(' <b>a &amp; b</b>\n  c '), 'a & b c');
  assert.equal(cleanText(null), '');
});

test('parseOpenApiPage: 제목/요청주소/서비스 URL/트래픽', () => {
  const s = parseOpenApiPage(html);
  assert.equal(s.found, true);
  assert.equal(s.title, '한국천문연구원_특일 정보');
  assert.equal(s.endpoint, 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getAnniversaryInfo');
  assert.equal(s.serviceUrl, 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService');
  assert.match(s.traffic, /개발계정/);
});

test('parseOpenApiPage: 상세기능(오퍼레이션) 목록', () => {
  const s = parseOpenApiPage(html);
  assert.equal(s.operations.length, 5);
  assert.deepEqual(s.operations[1], { id: '24868', name: '공휴일 정보 조회' });
});

test('parseOpenApiPage: 요청변수(서비스키 제외)와 필수 표시', () => {
  const s = parseOpenApiPage(html);
  const names = s.request.map((r) => r.name);
  assert.deepEqual(names.slice(0, 4), ['pageNo', 'numOfRows', 'solYear', 'solMonth']);
  assert.ok(!names.some((n) => /servicekey/i.test(n)), '서비스키는 자동 부착이라 제외');
  const year = s.request.find((r) => r.name === 'solYear');
  assert.equal(year.required, true);
  assert.equal(year.sample, '2019');
});

test('parseOpenApiPage: 응답 항목', () => {
  const s = parseOpenApiPage(html);
  const names = s.response.map((r) => r.name);
  assert.ok(names.includes('resultCode') && names.includes('totalCount') && names.includes('locdate'));
});

test('buildExampleParams: 필수 파라미터만 샘플값으로', () => {
  const s = parseOpenApiPage(html);
  const p = buildExampleParams(s.request);
  assert.equal(p.solYear, '2019');
  assert.equal(p.pageNo, '1');
});

test('parseOpenApiPage: 엉뚱한 HTML 이면 found=false', () => {
  assert.equal(parseOpenApiPage('<html><title>오류 | 공공데이터포털</title></html>').found, false);
  assert.equal(parseOpenApiPage('').found, false);
});

test('fetchApiSpec: URL 구성/에러 처리 (주입 fetch)', async () => {
  const seen = [];
  const ok = async (url) => { seen.push(url); return { ok: true, status: 200, text: async () => html }; };
  const spec = await fetchApiSpec('15012690', { fetchImpl: ok });
  assert.equal(seen[0], 'https://www.data.go.kr/data/15012690/openapi.do');
  assert.equal(spec.id, '15012690');
  await assert.rejects(() => fetchApiSpec('abc', { fetchImpl: ok }), /id/);
  await assert.rejects(() => fetchApiSpec('15012690', { fetchImpl: async () => ({ ok: false, status: 404 }) }), /404/);
});

import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/mcp.js';
import { createRegistry } from '../src/registry.js';
import { registerTools } from '../src/tools.js';

test('describe_api 도구: 명세와 call_api 예시 반환', async () => {
  const s = createServer();
  const reg = createRegistry(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'datago-')), 'c.json'));
  registerTools(s, { registry: reg, fetchImpl: async () => ({ ok: true, status: 200, text: async () => html }) });
  const res = await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'describe_api', arguments: { idOrUrl: 'https://www.data.go.kr/data/15012690/openapi.do' } } });
  const out = JSON.parse(res.result.content[0].text);
  assert.equal(out.제목, '한국천문연구원_특일 정보');
  assert.equal(out.call_api_예시.params.solYear, '2019');
  assert.ok(out.요청변수.some((l) => l.startsWith('[필수] solYear')));
});

test('describe_api 도구: 파싱 불가 페이지는 안내 문구', async () => {
  const s = createServer();
  const reg = createRegistry(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'datago-')), 'c.json'));
  registerTools(s, { registry: reg, fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<title>x | y</title>' }) });
  const res = await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'describe_api', arguments: { idOrUrl: '15099999' } } });
  assert.match(res.result.content[0].text, /직접 확인/);
});
