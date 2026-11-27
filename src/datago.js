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
  // 서울 열린데이터광장 계열
  'INFO-100': '인증키가 유효하지 않음',
  'INFO-200': '해당하는 데이터가 없음',
  'ERROR-300': '필수 값 누락',
  'ERROR-310': '해당하는 서비스를 찾을 수 없음',
  'ERROR-336': '데이터 요청은 한 번에 최대 1,000건까지',
  'ERROR-500': '서버 오류',
};

export function describeResultCode(code) {
  if (code == null) return null;
  const c = String(code).padStart(2, '0');
  return RESULT_CODES[c] || RESULT_CODES[String(code).toUpperCase()] || RESULT_CODES[String(Number(code))] || `알 수 없는 코드(${code})`;
}

// 코드별 "그래서 뭘 하면 되는지" 안내. AI/사용자가 바로 다음 행동을 알 수 있게 한다.
export const RESULT_HINTS = {
  '01': '포털/기관 서버 내부 오류예요. 잠시 후 다시 시도하세요(자동 재시도했어요).',
  '02': '기관 DB 오류예요. 잠시 후 다시 시도하세요.',
  '05': '기관 서버가 응답하지 않아요. 잠시 후 다시 시도하세요.',
  '33': '서명이 필요한 API 예요. 포털 상세 페이지의 호출 방법을 확인하세요.',
  'INFO-100': '인증키가 유효하지 않아요. 서울 열린데이터광장 등 기관 자체 키가 필요한 API 일 수 있어요(공공데이터포털 키가 아님).',
  'INFO-200': '조건에 맞는 데이터가 없어요. 범위를 넓혀 보세요.',
  'ERROR-300': '필수 값이 빠졌어요. describe_api 의 [필수] 항목을 확인하세요.',
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

// 같은 안내의 영어판 — 구조화 출력의 `hint` 키(모델용). 한국어 안내는 `advice`.
export const RESULT_HINTS_EN = {
  '01': 'Provider server error; retry shortly.', '02': 'Provider database error; retry shortly.', '03': 'No data for these parameters; widen the range.',
  '05': 'Provider did not respond; retry later.',
  '10': 'Bad parameter format; check types/lengths with describe_api.', '11': 'Required parameter missing; compare with describe_api [required] list.',
  '12': 'Wrong or retired URL; re-read the endpoint with describe_api.', '20': 'Application not approved yet; check my_applications (auto-approval can take 1-2h).',
  '21': 'Key temporarily disabled; retry later.', '22': 'Daily traffic limit exceeded; wait until tomorrow or request an increase (see quota_status).',
  '30': 'Key not registered: typo, approval still pending, or key belongs to another API; run doctor.', '31': 'Usage period expired; extend it on the portal.',
  '32': 'Caller IP not registered in the account settings.', '33': 'Call must be signed; follow the portal call instructions.',
  'INFO-100': 'Agency-specific key required (not the data.go.kr key).', 'INFO-200': 'No data for these parameters.', 'ERROR-300': 'Required value missing; see describe_api.',
};

export function hintEnFor(code) {
  if (code == null) return null;
  const c = String(code).padStart(2, '0');
  return RESULT_HINTS_EN[c] || RESULT_HINTS_EN[String(code).toUpperCase()] || null;
}

export function hintFor(code) {
  if (code == null) return null;
  const c = String(code).padStart(2, '0');
  return RESULT_HINTS[c] || RESULT_HINTS[String(code).toUpperCase()] || null;
}

// 로그/오류 메시지용: serviceKey 값을 가린다 (키가 로그에 남지 않게)
export function maskUrl(url) {
  return String(url).replace(/([?&]serviceKey=)[^&]*/gi, '$1***');
}

// 정상 응답 코드: 00/0000(표준), INFO-000(서울 열린데이터 계열), NORMAL_SERVICE/OK(일부 기관)
export function isSuccessCode(code) {
  const s = String(code ?? '').trim();
  return /^0+$/.test(s) || s === '200' || /^INFO-000$/i.test(s) || /^(NORMAL[_ ]SERVICE|OK)\.?$/i.test(s);
}

// 일시 장애라 재시도할 가치가 있는 resultCode (01 앱 에러, 02 DB 에러, 05 타임아웃)
export const RETRYABLE_CODES = new Set(['01', '02', '05']);

/**
 * @param {import('./types.js').Options} [options]
 */
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
/**
 * @param {any} [params]
 * @param {any} [params]
 * @param {any} [serviceKey]
 */
export function buildQuery(params = {}, serviceKey = undefined, { encodeKey } = {}) {
  const parts = [];
  if (serviceKey) {
    const key = String(serviceKey);
    const useEncoded = encodeKey ?? !isEncodedKey(key); // 디코딩 키면 인코딩, 인코딩 키면 그대로
    parts.push(`serviceKey=${useEncoded ? encodeURIComponent(key) : key}`);
  }
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    // 배열은 같은 키를 반복, 객체는 JSON 문자열(‘[object Object]’ 방지). 한글·특수문자는 UTF-8 퍼센트 인코딩
    const values = Array.isArray(v) ? v : [v];
    for (const one of values) {
      if (one === undefined || one === null) continue;
      const str = typeof one === 'object' ? JSON.stringify(one) : String(one);
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(str)}`);
    }
  }
  return parts.join('&');
}

export function buildUrl(base, params, serviceKey, opts) {
  const q = buildQuery(params, serviceKey, opts);
  if (!q) return base;
  return base + (base.includes('?') ? '&' : '?') + q;
}

// 코드 없이 문구만 오는 게이트웨이 오류(평문/XML returnAuthMsg) → 표준 resultCode
/** @type {[RegExp, string][]} */
const TEXT_CODES = [
  [/SERVICE[_ ]KEY[_ ]IS[_ ]NOT[_ ]REGISTERED/i, '30'], [/LIMITED[_ ]NUMBER[_ ]OF[_ ]SERVICE[_ ]REQUESTS[_ ]EXCEEDS/i, '22'],
  [/SERVICE[_ ]ACCESS[_ ]DENIED/i, '20'], [/UNREGISTERED[_ ]IP/i, '32'], [/DEADLINE[_ ]HAS[_ ]EXPIRED/i, '31'],
  [/TEMPORARILY[_ ]DISABLE[D_ ]THE[_ ]SERVICEKEY/i, '21'], [/NO[_ ]OPENAPI[_ ]SERVICE/i, '12'],
  [/INVALID[_ ]REQUEST[_ ]PARAMETER/i, '10'], [/NO[_ ]MANDATORY[_ ]REQUEST[_ ]PARAMETERS/i, '11'],
];
export function codeFromText(t) {
  const s = String(t ?? '');
  for (const [re, code] of TEXT_CODES) if (re.test(s)) return code;
  return null;
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
  // 게이트웨이/오류 HTML 페이지는 XML 이 아니다 (200 이어도 성공으로 보지 않음)
  if (data && kind === 'xml' && typeof data === 'object' && 'html' in data) { data = null; kind = 'text'; }
  if (data === null) {
    const fromText = codeFromText(text);
    return { kind: 'text', data: text, resultCode: fromText, resultMsg: fromText ? text.slice(0, 200) : null,
      html: /^<(?:!doctype html|html)[\s>]/i.test(text) };
  }

  // 공통 위치들에서 코드/메시지 추출
  const resultCode = findFirst(data, ['resultCode', 'returnReasonCode', 'errorCode', 'code', 'CODE']);
  const resultMsg = findFirst(data, ['resultMsg', 'returnAuthMsg', 'errMsg', 'errorMsg', 'message', 'MSG', 'MESSAGE']);
  return { kind, data, resultCode: resultCode ?? codeFromText(resultMsg), resultMsg };
}

const DEFAULT_FETCH = (url, init) => globalThis.fetch(url, init);
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
 * @returns {Promise<any>} { ok, httpStatus, resultCode, resultMsg, codeMeaning, hint, kind, data, url, usedEncodedKey, retried, attempts }
 */
export async function callApi({
  url, params = {}, serviceKey, method = 'GET', body, timeoutMs = 15000, fetchImpl = DEFAULT_FETCH,
  retries = 2, retryDelayMs = 500, sleep = DEFAULT_SLEEP, logger, breaker, signal,
}) {
  if (!url) throw new Error('url 이 필요합니다.');
  signal?.throwIfAborted();
  const wait = breaker?.check(url) || 0;
  if (wait > 0) throw new CircuitOpenError(new URL(url).host, wait);
  let attempts = 0;

  async function once(encodeKey) {
    const fullUrl = buildUrl(url, params, serviceKey, { encodeKey });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener('abort', onAbort, { once: true }); // 클라이언트 취소 → 요청 중단
    let res;
    const t0 = Date.now();
    try {
      logger?.(`→ ${method} ${maskUrl(fullUrl)}`);
      res = await fetchImpl(fullUrl, { method, body, signal: ctrl.signal, redirect: 'error' });
      logger?.(`← HTTP ${res.status} (${Date.now() - t0}ms)`);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    const contentType = res.headers?.get?.('content-type') || '';
    const text = await res.text();
    const { kind, data, resultCode, resultMsg, html } = interpret(text, contentType);
    // 200 이어도 본문이 HTML(게이트웨이/점검 페이지)이면 성공이 아니다
    const hint = hintFor(resultCode)
      || (html ? '응답이 JSON/XML 이 아니라 HTML 이에요. 기관 서버 점검·차단 페이지일 수 있어요. URL 과 잠시 후 재시도를 확인하세요.' : null)
      || (res.status >= 400 && kind === 'text' ? `HTTP ${res.status} 오류예요. URL 과 파라미터를 확인하세요.` : null);
    return {
      httpStatus: res.status,
      ok: res.ok && !html && (resultCode == null || isSuccessCode(resultCode)),
      resultCode,
      resultMsg,
      codeMeaning: describeResultCode(resultCode),
      hint,
      html: Boolean(html),
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
        if (signal?.aborted) throw signal.reason ?? e; // 취소는 재시도·차단기 집계 대상이 아님
        lastErr = e;
        breaker?.failure(url);
        if (i < retries) await sleep(backoffMs(i, retryDelayMs));
      }
    }
    const err = /** @type {any} */ (new Error(describeNetworkError(lastErr, timeoutMs)));
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
