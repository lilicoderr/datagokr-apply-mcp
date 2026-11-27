process.env.DATAGO_ALLOW_LOCAL = '1';
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
  assert.equal(out.title, '한국천문연구원_특일 정보');
  assert.equal(out.callExample.params.solYear, '2019');
  assert.ok(out.request.some((l) => l.startsWith('[필수] solYear')));
});

test('describe_api 도구: 파싱 불가 페이지는 안내 문구', async () => {
  const s = createServer();
  const reg = createRegistry(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'datago-')), 'c.json'));
  registerTools(s, { registry: reg, fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<title>x | y</title>' }) });
  const res = await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'describe_api', arguments: { idOrUrl: '15099999' } } });
  assert.match(res.result.content[0].text, /직접 확인/);
});

import { parseSearchResults, searchDatasets } from '../src/portal.js';
const searchHtml = fs.readFileSync(new URL('./fixtures/search-results.html', import.meta.url), 'utf8');

test('parseSearchResults: 카드 → 제목/분류/기관/summary/활용신청수', () => {
  const r = parseSearchResults(searchHtml);
  assert.equal(r.total, 194);
  assert.ok(r.items.length >= 2);
  const first = r.items[0];
  assert.equal(first.id, '15000314');
  assert.equal(first.title, '서울특별시_버스도착정보조회 서비스'); // <em> 강조 태그 제거
  assert.equal(first.format, 'XML');
  assert.equal(first.category, '교통물류');
  assert.equal(first.provider, '서울특별시');
  assert.match(first.summary, /실시간 버스 도착예정/);
  assert.equal(first.applications, '16,768건');
  assert.equal(first.link, 'https://www.data.go.kr/data/15000314/openapi.do');
});

test('parseSearchResults: 빈/이상한 HTML', () => {
  assert.deepEqual(parseSearchResults(''), { total: null, items: [] });
  assert.equal(parseSearchResults('<div>없음</div>').items.length, 0);
});

test('searchDatasets: 검색 URL 구성과 오류 처리', async () => {
  const seen = [];
  const fetchImpl = async (url) => { seen.push(url); return { ok: true, status: 200, text: async () => searchHtml }; };
  const r = await searchDatasets('버스 도착', { page: 2, fetchImpl });
  assert.match(seen[0], /keyword=%EB%B2%84%EC%8A%A4%20%EB%8F%84%EC%B0%A9/);
  assert.match(seen[0], /currentPage=2/);
  assert.ok(r.items.length >= 2);
  await assert.rejects(() => searchDatasets('  ', { fetchImpl }), /검색어/);
  await assert.rejects(() => searchDatasets('x', { fetchImpl: async () => ({ ok: false, status: 503 }) }), /503/);
});

import { isAutoApprovable, findApplyTargets } from '../src/portal.js';

test('parseOpenApiPage: 유형/심의/비용/활용신청 수', () => {
  const s = parseOpenApiPage(html);
  assert.equal(s.apiType, 'REST');
  assert.match(s.approval, /자동승인/);
  assert.equal(s.cost, '무료');
  assert.ok(s.applications);
});

test('isAutoApprovable: REST + 개발단계 자동승인만 true', () => {
  const base = { found: true, title: 't' };
  assert.equal(isAutoApprovable({ ...base, apiType: 'REST', approval: '개발단계 : 자동승인 / 운영단계 : 자동승인' }), true);
  assert.equal(isAutoApprovable({ ...base, apiType: 'REST', approval: '개발단계 : 심의승인 / 운영단계 : 심의승인' }), false);
  assert.equal(isAutoApprovable({ ...base, apiType: 'LINK', approval: '개발단계 : 자동승인' }), false);
  assert.equal(isAutoApprovable({ ...base, apiType: 'REST', approval: null }), false);
  assert.equal(isAutoApprovable(null), false);
});

test('findApplyTargets: 검색 → 상세 병렬 조회 → 자동승인만 반환 (브라우저 불필요)', async () => {
  const card = (id, t) => `<div class="in-result-item"><div class="apply-result-category"><span>분류</span><span>기관</span></div><div class="apply-result-link"><span data-ext="XML">XML</span><a href="/data/${id}/openapi.do">${t}</a></div><span class="apply-result-summary">summary</span><ul><li><strong>활용신청</strong> 10건</li></ul></div>`;
  const detail = (title, approval, type = 'REST') => `<title>${title} | 공공데이터포털</title><ul><li><strong class="key">API 유형</strong><div class="value">${type}</div></li><li><strong class="key">심의유형</strong><div class="value">${approval}</div></li><li><strong class="key">신청 가능 트래픽</strong><div class="value">개발계정 : 1,000</div></li></ul>`;
  const pages = {
    '111111': detail('A', '개발단계 : 자동승인 / 운영단계 : 자동승인'),
    '222222': detail('B', '개발단계 : 심의승인 / 운영단계 : 심의승인'),
    '333333': detail('C', '개발단계 : 자동승인 / 운영단계 : 자동승인'),
  };
  const fetchImpl = async (url) => {
    if (url.includes('selectDataSetList')) {
      const page = Number(new URL(url).searchParams.get('currentPage'));
      return { ok: true, status: 200, text: async () => (page === 1 ? card('111111', 'A') + card('222222', 'B') + card('333333', 'C') : '') };
    }
    const id = url.match(/data\/(\d+)\//)[1];
    return { ok: true, status: 200, text: async () => pages[id] };
  };
  const r = await findApplyTargets('테스트', { limit: 5, fetchImpl });
  assert.deepEqual(r.targets.map((t) => t.id), ['111111', '333333']);
  assert.equal(r.scanned, 3);
  const r1 = await findApplyTargets('테스트', { limit: 1, fetchImpl });
  assert.equal(r1.targets.length, 1);
});
