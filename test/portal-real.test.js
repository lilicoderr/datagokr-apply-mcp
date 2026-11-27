// 실제 공개 페이지(2026-11 수집, 로그인 불필요)를 정리해 저장한 fixture 로 파서 회귀 테스트.
process.env.DATAGO_ALLOW_LOCAL = '1';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOpenApiPage, parseSearchResults, cleanText } from '../src/portal.js';

const read = (n) => fs.readFileSync(new URL(`./fixtures/real/${n}`, import.meta.url), 'utf8');

test('cleanText: 숫자 문자 참조(&#034;)와 이중 디코딩 방지', () => {
  assert.equal(cleanText('&#034;가&#x45;&#34;'), '"가E"');
  assert.equal(cleanText('&amp;#39;'), '&#39;');
  assert.equal(cleanText('a&#99999999999;b'), 'ab');
});

test('실제 상세 페이지(에어코리아): 다중 오퍼레이션 + JSON+XML + 심의유형', () => {
  const s = parseOpenApiPage(read('openapi-airkorea.html'));
  assert.equal(s.found, true);
  assert.equal(s.title, '한국환경공단_에어코리아_대기오염정보');
  assert.equal(s.format, 'JSON+XML');
  assert.equal(s.apiType, 'REST');
  assert.ok(s.operations.length >= 5);
  assert.match(s.endpoint, /^https:\/\/apis\.data\.go\.kr\/B552584\//);
  assert.ok(!s.description.includes('&#034;'), '엔티티 디코딩');
  assert.ok(s.request.every((r) => r.name && typeof r.required === 'boolean'));
});

test('실제 상세 페이지(특일 정보): 필수 파라미터와 응답 항목', () => {
  const s = parseOpenApiPage(read('openapi-spcde.html'));
  assert.deepEqual(s.request.filter((r) => r.required).map((r) => r.name), ['pageNo', 'numOfRows', 'solYear']);
  assert.ok(s.response.length >= 5);
  assert.equal(s.detailPk, 'uddi:d06c27ff-c0c5-464d-af1b-8f0c56d17e75_202006101104');
});

test('실제 검색 결과: 10건 + 전체 건수', () => {
  const r = parseSearchResults(read('search-real.html'));
  assert.equal(r.total, 916);
  assert.equal(r.items.length, 10);
  for (const it of r.items) {
    assert.match(it.id, /^\d+$/);
    assert.ok(it.title);
    assert.match(it.link, /\/data\/\d+\/openapi\.do$/);
  }
});

test('빈 검색 결과 / 404 에러 페이지는 found=false 로 안전하게 처리', () => {
  const r = parseSearchResults(read('search-empty.html'));
  assert.equal(r.items.length, 0);
  assert.equal(r.total, 0);
  const s = parseOpenApiPage(read('not-found-404.html'));
  assert.equal(s.found, false);
  assert.equal(s.reason, 'no_spec');
});

// ── fetchApiSpec: 오퍼레이션 / 오류 UX (네트워크는 fixture 로 대체) ──
import { fetchApiSpec, searchDatasets } from '../src/portal.js';

const reply = (body, status = 200) => ({ ok: status < 400, status, text: async () => body });

test('fetchApiSpec: operation 지정 시 기능별 요청주소/변수를 POST 로 가져온다', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: String(init.body || '') });
    return reply(url.includes('selectApiDetailFunction') ? read('operation-fragment.html') : read('openapi-spcde.html'));
  };
  const s = await fetchApiSpec('15012690', { operation: '공휴일', fetchImpl });
  assert.equal(calls[1].method, 'POST');
  assert.match(calls[1].body, /oprtinSeqNo=24868/);
  assert.match(calls[1].body, /publicDataPk=15012690/);
  assert.equal(s.operation.name, '공휴일 정보 조회');
  assert.match(s.endpoint, /getRestDeInfo$/);
  assert.ok(s.request.length > 0);
});

test('fetchApiSpec: 없는 operation 은 가능한 기능 목록을 안내', async () => {
  const fetchImpl = async () => reply(read('openapi-spcde.html'));
  await assert.rejects(fetchApiSpec('15012690', { operation: '없는기능', fetchImpl }),
    (e) => /공휴일 정보 조회/.test(e.message) && /operation/i.test(e.hint));
});

test('오류 UX: 404/5xx/네트워크/타임아웃 모두 한국어 message + 영어 hint', async () => {
  await assert.rejects(fetchApiSpec('99999999', { fetchImpl: async () => reply('x', 404) }),
    (e) => /HTTP 404/.test(e.message) && /Not found/.test(e.hint));
  await assert.rejects(fetchApiSpec('15012690', { fetchImpl: async () => reply('x', 503) }),
    (e) => /HTTP 503/.test(e.message) && /503/.test(e.hint));
  await assert.rejects(searchDatasets('날씨', { fetchImpl: async () => { throw new Error('ECONNRESET'); } }),
    (e) => /네트워크/.test(e.message) && /Network/.test(e.hint));
  const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
  await assert.rejects(searchDatasets('날씨', { fetchImpl: async () => { throw abortErr; } }),
    (e) => /초 안에/.test(e.message) && /timed out/.test(e.hint));
  await assert.rejects(fetchApiSpec('abc', {}), (e) => /id/.test(e.message) && Boolean(e.hint));
});
