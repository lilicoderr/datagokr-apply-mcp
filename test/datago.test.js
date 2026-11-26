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

// ── 재시도 / 백오프 / 힌트 ──
import { isRetryable, backoffMs, hintFor, describeNetworkError } from '../src/datago.js';

const jsonRes = (code, status = 200) => ({
  ok: status < 400, status, headers: { get: () => 'application/json' },
  text: async () => JSON.stringify({ response: { header: { resultCode: code } } }),
});

test('isRetryable: 5xx/429/네트워크/일시 코드만', () => {
  assert.equal(isRetryable({ httpStatus: 503 }), true);
  assert.equal(isRetryable({ httpStatus: 429 }), true);
  assert.equal(isRetryable({ httpStatus: 200, resultCode: '05' }), true);
  assert.equal(isRetryable({ error: new Error('x') }), true);
  assert.equal(isRetryable({ httpStatus: 200, resultCode: '22' }), false); // 한도 초과는 재시도 무의미
  assert.equal(isRetryable({ httpStatus: 200, resultCode: '00' }), false);
  assert.equal(isRetryable({ httpStatus: 404 }), false);
});

test('backoffMs: 지수 증가 + 상한 8초', () => {
  const noJitter = () => 0;
  assert.equal(backoffMs(0, 500, noJitter), 500);
  assert.equal(backoffMs(1, 500, noJitter), 1000);
  assert.equal(backoffMs(2, 500, noJitter), 2000);
  assert.equal(backoffMs(10, 500, noJitter), 8000);
});

test('hintFor: 코드별 조치 안내', () => {
  assert.match(hintFor('22'), /트래픽/);
  assert.match(hintFor(30), /doctor/);
  assert.equal(hintFor('00'), null);
  assert.equal(hintFor(null), null);
});

test('callApi: 5xx 는 백오프 재시도 후 성공', async () => {
  const sleeps = [];
  let n = 0;
  const fetchImpl = async () => (++n < 3 ? jsonRes('05', 503) : jsonRes('00'));
  const r = await callApi({ url: 'http://x', serviceKey: 'k', fetchImpl, sleep: async (ms) => sleeps.push(ms), retryDelayMs: 100 });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 3);
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[1] >= sleeps[0], '대기 시간 증가');
});

test('callApi: 일시 resultCode(05) 재시도, 한도초과(22)는 즉시 반환', async () => {
  let n = 0;
  const r1 = await callApi({ url: 'http://x', serviceKey: 'k', sleep: async () => {}, fetchImpl: async () => (++n < 2 ? jsonRes('05') : jsonRes('00')) });
  assert.equal(r1.resultCode, '00');
  n = 0;
  const r2 = await callApi({ url: 'http://x', serviceKey: 'k', sleep: async () => {}, fetchImpl: async () => { n++; return jsonRes('22'); } });
  assert.equal(n, 1);
  assert.equal(r2.resultCode, '22');
  assert.match(r2.hint, /한도/);
});

test('callApi: 네트워크 오류 반복 시 친절한 메시지로 throw', async () => {
  let n = 0;
  const fetchImpl = async () => { n++; const e = new TypeError('fetch failed'); e.cause = { code: 'ENOTFOUND' }; throw e; };
  await assert.rejects(
    () => callApi({ url: 'http://nope.invalid', serviceKey: 'k', fetchImpl, sleep: async () => {}, retries: 2 }),
    (err) => { assert.match(err.message, /DNS/); assert.equal(err.attempts, 3); return true; },
  );
  assert.equal(n, 3);
});

test('describeNetworkError: 종류별 메시지', () => {
  assert.match(describeNetworkError({ name: 'AbortError' }, 15000), /시간 초과/);
  assert.match(describeNetworkError({ cause: { code: 'ECONNREFUSED' } }), /연결 거부/);
  assert.match(describeNetworkError(new TypeError('Invalid URL')), /URL 형식/);
});

test('callApi: retries=0 이면 재시도 안 함', async () => {
  let n = 0;
  const r = await callApi({ url: 'http://x', serviceKey: 'k', retries: 0, sleep: async () => {}, fetchImpl: async () => { n++; return jsonRes('05', 503); } });
  assert.equal(n, 1);
  assert.equal(r.ok, false);
});
