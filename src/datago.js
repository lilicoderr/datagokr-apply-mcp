// 공공데이터포털(data.go.kr) 오픈API 호출 클라이언트
//
//   핵심은 두 가지 함정 처리:
//   1) 서비스키 이중 인코딩: 포털은 "Encoding 키"(%2B/%2F 포함)와 "Decoding 키" 두 가지를 준다.
//      인코딩 키를 또 인코딩하면 SERVICE_KEY_IS_NOT_REGISTERED(30) 가 난다.
//      → 키가 이미 %인코딩돼 있으면 그대로, 아니면 한 번만 인코딩. 실패하면 반대 형태로 1회 재시도.
//   2) 응답이 JSON/XML 섞여 있고, 에러를 HTTP 200 + resultCode 로 주는 경우가 많다.
//      → 공통 resultCode 를 해석해 사람이 읽을 메시지로.

import { parseXml, findFirst } from './xml.js';
import { CircuitOpenError } from './breaker.js';

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

// 코드별 "그래서 뭘 하면 되는지" 안내. AI/사용자가 바로 다음 행동을 알 수 있게 한다.
export const RESULT_HINTS = {
  '03': '조건에 맞는 데이터가 없어요. 날짜·지역코드 등 파라미터 범위를 넓혀 보세요.',
  '10': '파라미터 형식이 틀렸어요. 해당 API 의 요청 변수 표(타입/자리수)를 확인하세요.',
  '11': '필수 파라미터가 빠졌어요. 오픈API 상세 페이지의 "필수" 항목을 모두 넣었는지 보세요.',
  '12': 'URL 이 틀렸거나 폐기된 API 예요. 포털 상세 페이지의 최신 요청 주소를 확인하세요.',
  '20': '활용신청이 승인되지 않았어요. my_applications 로 승인 상태를 확인하고, 자동승인 API 라도 1~2시간 걸릴 수 있어요.',
  '21': '키가 일시적으로 사용 불가예요. 잠시 후 다시 시도하세요.',
  '22': '일일 트래픽 한도를 넘겼어요. 내일 다시 하거나 포털에서 트래픽 증설을 신청하세요. (quota_status 로 오늘 호출량 확인)',
  '30': '등록되지 않은 키예요. 키 오타, 승인 대기(활용신청 직후 1~2시간), 다른 API 의 키 사용 여부를 확인하세요. (doctor 로 점검)',
  '31': '활용 기간이 만료됐어요. 포털에서 연장 신청을 하세요.',
  '32': '호출 IP 가 등록된 IP 가 아니에요. 포털 개발계정 설정에서 IP 를 확인하세요.',
};

export function hintFor(code) {
  if (code == null) return null;
  const c = String(code).padStart(2, '0');
  return RESULT_HINTS[c] || null;
}

// 로그/오류 메시지용: serviceKey 값을 가린다 (키가 로그에 남지 않게)
export function maskUrl(url) {
  return String(url).replace(/([?&]serviceKey=)[^&]*/gi, '$1***');
}

// 정상 응답 코드: 00/0000(표준), INFO-000(서울 열린데이터 계열), NORMAL_SERVICE/OK(일부 기관)
export function isSuccessCode(code) {
  const s = String(code ?? '').trim();
  return /^0+$/.test(s) || /^INFO-000$/i.test(s) || /^(NORMAL[_ ]SERVICE|OK)\.?$/i.test(s);
}

// 일시 장애라 재시도할 가치가 있는 resultCode (01 앱 에러, 02 DB 에러, 05 타임아웃)
export const RETRYABLE_CODES = new Set(['01', '02', '05']);

export function isRetryable({ httpStatus, resultCode, error } = {}) {
  if (error) return true; // 네트워크 오류/타임아웃
  if (httpStatus === 429 || (httpStatus >= 500 && httpStatus <= 599)) return true;
  if (resultCode != null && RETRYABLE_CODES.has(String(resultCode).padStart(2, '0'))) return true;
  return false;
}

// 지수 백오프: base * 2^attempt (+0~20% 지터), 최대 8초
export function backoffMs(attempt, base = 500, rand = Math.random) {
  const raw = base * 2 ** attempt;
  return Math.min(8000, Math.round(raw * (1 + rand() * 0.2)));
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
const DEFAULT_SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

// 네트워크 오류를 사람이 읽을 메시지로
export function describeNetworkError(e, timeoutMs) {
  if (e?.name === 'AbortError') return `응답 시간 초과(${timeoutMs}ms). 포털 서버가 느리거나 일시 장애일 수 있어요.`;
  const code = e?.cause?.code || e?.code;
  if (code === 'ENOTFOUND') return 'DNS 조회 실패 — URL 의 도메인이 맞는지, 인터넷 연결이 되는지 확인하세요.';
  if (code === 'ECONNREFUSED') return '연결 거부 — 서버가 꺼져 있거나 포트가 틀렸어요.';
  if (code === 'ECONNRESET') return '연결이 끊겼어요(ECONNRESET). 잠시 후 다시 시도하세요.';
  if (/Invalid URL/i.test(e?.message || '')) return `URL 형식이 올바르지 않아요: ${e.message}`;
  return `네트워크 오류: ${e?.cause?.message || e?.message || e}`;
}

/**
 * 오픈API 호출. 서비스키 이중 인코딩이면 반대 형태로 1회 자동 재시도하고,
 * 일시 장애(네트워크/5xx/429/resultCode 01·02·05)는 지수 백오프로 재시도한다.
 * @returns {{ok, httpStatus, resultCode, resultMsg, codeMeaning, hint, kind, data, url, usedEncodedKey, retried, attempts}}
 */
export async function callApi({
  url, params = {}, serviceKey, method = 'GET', body, timeoutMs = 15000, fetchImpl = DEFAULT_FETCH,
  retries = 2, retryDelayMs = 500, sleep = DEFAULT_SLEEP, logger, breaker,
}) {
  if (!url) throw new Error('url 이 필요합니다.');
  const wait = breaker?.check(url) || 0;
  if (wait > 0) throw new CircuitOpenError(new URL(url).host, wait);
  let attempts = 0;

  async function once(encodeKey) {
    const fullUrl = buildUrl(url, params, serviceKey, { encodeKey });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    const t0 = Date.now();
    try {
      logger?.(`→ ${method} ${maskUrl(fullUrl)}`);
      res = await fetchImpl(fullUrl, { method, body, signal: ctrl.signal });
      logger?.(`← HTTP ${res.status} (${Date.now() - t0}ms)`);
    } finally {
      clearTimeout(timer);
    }
    const contentType = res.headers?.get?.('content-type') || '';
    const text = await res.text();
    const { kind, data, resultCode, resultMsg } = interpret(text, contentType);
    return {
      httpStatus: res.status,
      ok: res.ok && (resultCode == null || isSuccessCode(resultCode)),
      resultCode,
      resultMsg,
      codeMeaning: describeResultCode(resultCode),
      hint: hintFor(resultCode),
      kind,
      data,
      url: fullUrl,
      usedEncodedKey: encodeKey ?? !isEncodedKey(String(serviceKey || '')),
    };
  }

  // 일시 장애 재시도 래퍼. 마지막 시도의 결과(또는 오류)를 돌려준다.
  async function withRetry(encodeKey) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
      attempts++;
      try {
        const r = await once(encodeKey);
        if (isRetryable(r)) breaker?.failure(url); else breaker?.success(url);
        if (i < retries && isRetryable(r)) { await sleep(backoffMs(i, retryDelayMs)); continue; }
        return r;
      } catch (e) {
        lastErr = e;
        breaker?.failure(url);
        if (i < retries) await sleep(backoffMs(i, retryDelayMs));
      }
    }
    const err = new Error(describeNetworkError(lastErr, timeoutMs));
    err.cause = lastErr;
    err.attempts = attempts;
    throw err;
  }

  const firstEncode = serviceKey ? !isEncodedKey(String(serviceKey)) : undefined;
  const result = await withRetry(firstEncode);

  // 서비스키 미등록(30) 이면 인코딩 형태를 뒤집어 한 번 더
  if (serviceKey && String(result.resultCode) === '30') {
    const retry = await withRetry(!firstEncode);
    retry.retried = true;
    if (String(retry.resultCode) !== '30') { retry.attempts = attempts; return retry; }
    result.retried = true;
  }
  result.attempts = attempts;
  return result;
}
