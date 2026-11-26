import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isEncodedKey, buildQuery, buildUrl, interpret, describeResultCode, callApi,
} from '../src/datago.js';

test('isEncodedKey: %인코딩 여부', () => {
  assert.equal(isEncodedKey('abc%2Bdef%2F'), true);
  assert.equal(isEncodedKey('abc+def/=='), false);
});

test('buildQuery: 디코딩 키는 인코딩, 인코딩 키는 그대로', () => {
  assert.equal(buildQuery({ a: 1 }, 'ab+c/d='), 'serviceKey=ab%2Bc%2Fd%3D&a=1');
  assert.equal(buildQuery({ a: 1 }, 'ab%2Bc'), 'serviceKey=ab%2Bc&a=1');
});

test('buildQuery: 파라미터 인코딩, null 생략', () => {
  assert.equal(buildQuery({ q: '가 나', skip: null, n: 10 }), 'q=%EA%B0%80%20%EB%82%98&n=10');
});

test('buildUrl: ? 와 & 처리', () => {
  assert.equal(buildUrl('http://x/api', { a: 1 }, null), 'http://x/api?a=1');
  assert.equal(buildUrl('http://x/api?z=0', { a: 1 }, null), 'http://x/api?z=0&a=1');
});

test('interpret: JSON 응답에서 resultCode 추출', () => {
  const r = interpret('{"response":{"header":{"resultCode":"03","resultMsg":"NO_DATA"}}}', 'application/json');
  assert.equal(r.kind, 'json');
  assert.equal(r.resultCode, '03');
  assert.equal(r.resultMsg, 'NO_DATA');
});

test('interpret: XML 에러 응답(cmmMsgHeader)', () => {
  const xml = '<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>';
  const r = interpret(xml, 'application/xml');
  assert.equal(r.kind, 'xml');
  assert.equal(r.resultCode, '30');
  assert.match(r.resultMsg, /SERVICE_KEY/);
});

test('describeResultCode', () => {
  assert.match(describeResultCode('00'), /정상/);
  assert.match(describeResultCode('30'), /등록되지 않은/);
  assert.match(describeResultCode(3), /데이터 없음/);   // 숫자 3 → '03'
});

test('callApi: 성공 응답 파싱 (주입 fetch)', async () => {
  const fetchImpl = async (url) => ({
    ok: true, status: 200, headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({ response: { header: { resultCode: '00' }, body: { totalCount: 5 } } }),
  });
  const r = await callApi({ url: 'http://x', serviceKey: 'plainkey', fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.resultCode, '00');
  assert.equal(r.data.response.body.totalCount, 5);
  assert.equal(r.usedEncodedKey, true); // 디코딩 키 → 인코딩해서 보냄
});

test('callApi: 서비스키 30 이면 인코딩 형태 뒤집어 재시도', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    // 첫 호출(인코딩)=30, 두번째(원본)=00
    const first = seen.length === 1;
    return {
      ok: true, status: 200, headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ response: { header: { resultCode: first ? '30' : '00' } } }),
    };
  };
  const r = await callApi({ url: 'http://x', serviceKey: 'rawkey', fetchImpl });
  assert.equal(seen.length, 2, '재시도 발생');
  assert.equal(r.resultCode, '00');
  assert.equal(r.retried, true);
});

test('callApi: url 없으면 에러', async () => {
  await assert.rejects(() => callApi({ serviceKey: 'k', fetchImpl: async () => ({}) }), /url/);
});
