// 공공데이터포털(data.go.kr) 오픈API 호출 클라이언트
//
//   핵심은 두 가지 함정 처리:
//   1) 서비스키 이중 인코딩: 포털은 "Encoding 키"(%2B/%2F 포함)와 "Decoding 키" 두 가지를 준다.
//      인코딩 키를 또 인코딩하면 SERVICE_KEY_IS_NOT_REGISTERED(30) 가 난다.
//      → 키가 이미 %인코딩돼 있으면 그대로, 아니면 한 번만 인코딩. 실패하면 반대 형태로 1회 재시도.
//   2) 응답이 JSON/XML 섞여 있고, 에러를 HTTP 200 + resultCode 로 주는 경우가 많다.
//      → 공통 resultCode 를 해석해 사람이 읽을 메시지로.

import { parseXml, findFirst } from './xml.js';

// data.go.kr 공통 결과 코드 (OpenAPI 표준)
export const RESULT_CODES = {
  '00': '정상',
  '01': '어플리케이션 에러',
  '02': 'DB 에러',
  '03': '데이터 없음',
  '04': 'HTTP 에러',
  '05': '서비스 연결 실패(타임아웃)',
  '10': '잘못된 요청 파라미터',
  '11': '필수 요청 파라미터 누락',
  '12': '해당 오픈API 서비스가 없거나 폐기됨',
  '20': '서비스 접근 거부 (활용신청 미승인/중지)',
  '21': '일시적으로 사용할 수 없는 서비스 키',
  '22': '서비스 요청 제한 횟수 초과',
  '30': '등록되지 않은 서비스 키 (키 오타 또는 이중 인코딩 의심)',
  '31': '활용 기간 만료',
  '32': '등록되지 않은 IP',
  '33': '서명되지 않은 호출',
  '99': '기타 오류',
};

export function describeResultCode(code) {
  if (code == null) return null;
  const c = String(code).padStart(2, '0');
  return RESULT_CODES[c] || RESULT_CODES[String(Number(code))] || `알 수 없는 코드(${code})`;
}

// 키가 이미 URL 인코딩된(Encoding) 키인지 추정
export function isEncodedKey(key) {
  return /%[0-9A-Fa-f]{2}/.test(String(key));
}

// 쿼리스트링 구성. serviceKey 는 형태에 따라 인코딩 여부를 달리한다.
export function buildQuery(params = {}, serviceKey, { encodeKey } = {}) {
  const parts = [];
  if (serviceKey) {
    const key = String(serviceKey);
    const useEncoded = encodeKey ?? !isEncodedKey(key); // 디코딩 키면 인코딩, 인코딩 키면 그대로
    parts.push(`serviceKey=${useEncoded ? encodeURIComponent(key) : key}`);
  }
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.join('&');
}

export function buildUrl(base, params, serviceKey, opts) {
  const q = buildQuery(params, serviceKey, opts);
  if (!q) return base;
  return base + (base.includes('?') ? '&' : '?') + q;
}

// 응답 본문 해석 (JSON 또는 XML) → { kind, data, resultCode, resultMsg }
export function interpret(bodyText, contentType = '') {
  const text = String(bodyText || '').trim();
  let data = null;
  let kind = 'text';
  if (/json/i.test(contentType) || text.startsWith('{') || text.startsWith('[')) {
    try { data = JSON.parse(text); kind = 'json'; } catch { /* 아래 */ }
  }
  if (data === null && (text.startsWith('<') || /xml/i.test(contentType))) {
    try { data = parseXml(text); kind = 'xml'; } catch { /* 아래 */ }
  }
  if (data === null) return { kind: 'text', data: text, resultCode: null, resultMsg: null };

  // 공통 위치들에서 코드/메시지 추출
  const resultCode = findFirst(data, ['resultCode', 'returnReasonCode', 'errorCode', 'code', 'CODE']);
  const resultMsg = findFirst(data, ['resultMsg', 'returnAuthMsg', 'errMsg', 'errorMsg', 'message', 'MSG']);
  return { kind, data, resultCode, resultMsg };
}

const DEFAULT_FETCH = (...a) => globalThis.fetch(...a);

/**
 * 오픈API 호출. 서비스키 이중 인코딩이면 반대 형태로 1회 자동 재시도.
 * @returns {{ok, httpStatus, resultCode, resultMsg, codeMeaning, kind, data, url, usedEncodedKey, retried}}
 */
export async function callApi({
  url, params = {}, serviceKey, method = 'GET', body, timeoutMs = 15000, fetchImpl = DEFAULT_FETCH,
}) {
  if (!url) throw new Error('url 이 필요합니다.');

  async function once(encodeKey) {
    const fullUrl = buildUrl(url, params, serviceKey, { encodeKey });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(fullUrl, { method, body, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    const contentType = res.headers?.get?.('content-type') || '';
    const text = await res.text();
    const { kind, data, resultCode, resultMsg } = interpret(text, contentType);
    return {
      httpStatus: res.status,
      ok: res.ok && (resultCode == null || /^0+$/.test(String(resultCode))),
      resultCode,
      resultMsg,
      codeMeaning: describeResultCode(resultCode),
      kind,
      data,
      url: fullUrl,
      usedEncodedKey: encodeKey ?? !isEncodedKey(String(serviceKey || '')),
    };
  }

  const firstEncode = serviceKey ? !isEncodedKey(String(serviceKey)) : undefined;
  let result = await once(firstEncode);

  // 서비스키 미등록(30) 이면 인코딩 형태를 뒤집어 한 번 더
  if (serviceKey && String(result.resultCode) === '30') {
    const retry = await once(!firstEncode);
    retry.retried = true;
    if (String(retry.resultCode) !== '30') return retry;
    result.retried = true;
  }
  return result;
}
