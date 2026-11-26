// 공공데이터포털 오픈API 상세 페이지(공개, 로그인 불필요) 파서.
//
//   https://www.data.go.kr/data/<id>/openapi.do 는 서버 렌더링 HTML 이라
//   요청주소·요청변수·응답항목·트래픽 같은 "호출에 필요한 명세"를 그대로 읽을 수 있다.
//   → AI 가 call_api 를 부르기 전에 describe_api 로 정확한 URL/필수 파라미터를 알 수 있다.
//
//   포털 HTML 구조에 의존하므로(베스트 에포트) 파싱은 순수 함수로 분리하고 fixture 로 테스트한다.

const BASE = 'https://www.data.go.kr';

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

export function cleanText(s) {
  return String(s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, (m) => ENTITIES[m])
    .replace(/\s+/g, ' ')
    .trim();
}

// <strong class="key">키</strong><div class="value">값</div> 쌍
function parseInfo(html) {
  const info = {};
  const re = /<strong class="key">([\s\S]*?)<\/strong>\s*<div class="value">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html))) {
    const k = cleanText(m[1]);
    const v = cleanText(m[2]);
    if (k && !(k in info)) info[k] = v; // 같은 키가 또 나오면(예: 트래픽) 첫 값 유지
  }
  return info;
}

function parseOperations(html) {
  const sel = html.match(/<select[^>]*id="open_api_detail_select"[^>]*>([\s\S]*?)<\/select>/);
  if (!sel) return [];
  return [...sel[1].matchAll(/<option value="(\d+)"[^>]*>([\s\S]*?)<\/option>/g)]
    .map((m) => ({ id: m[1], name: cleanText(m[2]) }));
}

// 표 한 개 → 행 배열 [{ko, name, size, required, sample, desc}]
function parseParamTable(tableHtml) {
  const rows = [];
  for (const tr of tableHtml.match(/<tr[\s\S]*?<\/tr>/g) || []) {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => cleanText(m[1]));
    if (tds.length < 6) continue;
    const [ko, name, size, division, sample, desc] = tds;
    rows.push({ ko, name, size, required: division === '필', sample: sample === '-' ? '' : sample, desc });
  }
  return rows;
}

export function parseOpenApiPage(html) {
  const text = String(html || '');
  const title = cleanText((text.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').split('|')[0].trim();
  const info = parseInfo(text);
  const tables = [...text.matchAll(/<table[^>]*class="[^"]*\bdata\b[^"]*"[\s\S]*?<\/table>/g)].map((m) => m[0]);
  const request = tables[0] ? parseParamTable(tables[0]) : [];
  const response = tables[1] ? parseParamTable(tables[1]) : [];

  const endpoint = info['요청주소'] || null;
  const serviceUrl = info['서비스 URL'] || null;
  return {
    title,
    provider: info['제공기관'] || null,
    description: info['설명'] || null,
    format: info['데이터 포맷'] || null,
    traffic: info['신청 가능 트래픽'] || null,
    approval: info['활용승인 절차'] || null,
    endpoint,
    serviceUrl,
    operations: parseOperations(text),
    request: request.filter((r) => !/^service\s*key$/i.test(r.name)), // 서비스키는 서버가 자동 부착
    response,
    found: Boolean(title && (endpoint || request.length)),
  };
}

// 필수 파라미터만 골라 call_api 호출 예시(params 객체)를 만든다 (샘플값 사용)
export function buildExampleParams(request = []) {
  const params = {};
  for (const r of request) {
    if (r.required) params[r.name] = r.sample || '';
  }
  return params;
}

export async function fetchApiSpec(id, { fetchImpl = (...a) => globalThis.fetch(...a), timeoutMs = 15000 } = {}) {
  const pk = String(id || '').match(/\d{5,}/)?.[0];
  if (!pk) throw new Error('데이터 id(숫자, 예 15012690)를 넣어주세요.');
  const url = `${BASE}/data/${pk}/openapi.do`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0 datagokr-apply-mcp' }, signal: ctrl.signal });
  } finally { clearTimeout(timer); }
  if (!res.ok) throw new Error(`상세 페이지를 가져오지 못했어요(HTTP ${res.status}). id 가 맞는지 확인하세요: ${url}`);
  const spec = parseOpenApiPage(await res.text());
  return { id: pk, pageUrl: url, ...spec };
}
