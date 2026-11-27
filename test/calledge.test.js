// call_api 응답 해석/파라미터 인코딩 엣지 케이스
import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret, buildQuery, callApi, isSuccessCode, describeResultCode, hintFor, codeFromText } from '../src/datago.js';

const reply = (body, { status = 200, type = 'application/json' } = {}) => ({
  ok: status < 400, status, headers: { get: () => type }, text: async () => body,
});

test('buildQuery: 한글/특수문자/배열/객체/빈 문자열', () => {
  const q = buildQuery({ n: '서울 강남&구=1', list: ['a', 'b'], o: { x: 1 }, e: '', skip: undefined, nul: null }, 'k==');
  assert.match(q, /^serviceKey=k%3D%3D&/);
  assert.ok(q.includes('n=%EC%84%9C%EC%9A%B8%20%EA%B0%95%EB%82%A8%26%EA%B5%AC%3D1'));
  assert.ok(q.includes('list=a&list=b'));
  assert.ok(q.includes('o=%7B%22x%22%3A1%7D'));
  assert.ok(q.includes('e='));
  assert.ok(!q.includes('skip') && !q.includes('nul'));
});

test('interpret: HTML 게이트웨이 페이지는 XML 이 아니라 text + html 플래그', () => {
  const r = interpret('<!DOCTYPE html><html><body><h1>502</h1></body></html>', 'text/html');
  assert.equal(r.kind, 'text');
  assert.equal(r.html, true);
});

test('interpret: 코드 없는 평문/XML 문구를 표준 코드로 매핑', () => {
  assert.equal(interpret('SERVICE KEY IS NOT REGISTERED').resultCode, '30');
  assert.equal(codeFromText('LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR.'), '22');
  const x = '<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_ACCESS_DENIED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>';
  assert.equal(interpret(x, 'text/xml').resultCode, '20');
  assert.equal(codeFromText('hello'), null);
});

test('interpret: BOM 이 붙은 JSON, 빈 본문', () => {
  assert.equal(interpret('\uFEFF{"response":{"header":{"resultCode":"00"}}}', 'application/json').resultCode, '00');
  assert.deepEqual(interpret('', '').data, '');
});

test('성공/서울 코드 해석', () => {
  assert.ok(isSuccessCode(200) && isSuccessCode('INFO-000'));
  assert.equal(describeResultCode('INFO-200'), '해당하는 데이터가 없음');
  assert.match(hintFor('INFO-200'), /데이터/);
  assert.match(hintFor('05'), /응답/);
});

test('callApi: 200 + HTML 본문은 ok=false 와 안내', async () => {
  const r = await callApi({ url: 'https://apis.data.go.kr/x', serviceKey: 'k'.repeat(20), retries: 0,
    fetchImpl: async () => reply('<html><body>점검중</body></html>', { type: 'text/html' }) });
  assert.equal(r.ok, false);
  assert.match(r.hint, /HTML/);
});

test('callApi: 평문 SERVICE KEY IS NOT REGISTERED → 30 으로 인코딩 뒤집어 재시도', async () => {
  const urls = [];
  const r = await callApi({ url: 'https://apis.data.go.kr/x', serviceKey: 'abc+/=' + 'z'.repeat(14), retries: 0,
    fetchImpl: async (u) => { urls.push(u); return reply('SERVICE KEY IS NOT REGISTERED', { type: 'text/plain' }); } });
  assert.equal(r.resultCode, '30');
  assert.equal(urls.length, 2);
  assert.equal(r.retried, true);
});
