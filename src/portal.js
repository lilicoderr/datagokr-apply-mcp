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
    .replace(/<\/?(?:em|b|i|u|mark|span|strong|a)\b[^>]*>/gi, '') // 인라인 강조는 단어를 쪼개지 않게 그냥 제거
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
    updated: info['수정일'] || info['최종수정일'] || info['최종 수정일'] || null,
    format: info['데이터 포맷'] || null,
    apiType: info['API 유형'] || null,
    reviewType: info['심의유형'] || null,
    cost: info['비용부과유무'] || null,
    applications: info['활용신청 수'] || null,
    traffic: info['신청 가능 트래픽'] || null,
    approval: info['활용승인 절차'] || info['심의유형'] || null,
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

// ── 검색 결과 ──
//   https://www.data.go.kr/tcs/dss/selectDataSetList.do?dType=API&keyword=... (공개)
//   결과 카드(.in-result-item): 분류 배지, 형식(XML/JSON), 제목 링크, 요약, 제공기관/수정일/조회수/활용신청/키워드
export function parseSearchResults(html) {
  const text = String(html || '');
  const total = Number((text.match(/전체\s*<span>\s*([\d,]+)\s*건/) || [])[1]?.replace(/,/g, '')) || null;
  const starts = [...text.matchAll(/<div class="in-result-item">/g)].map((m) => m.index);
  const items = [];
  starts.forEach((s, i) => {
    const block = text.slice(s, starts[i + 1] ?? s + 6000);
    const link = block.match(/<a href="\/data\/(\d+)\/openapi\.do"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) return; // 파일데이터 등 openapi 가 아닌 카드는 제외
    const meta = {};
    for (const m of block.matchAll(/<strong>([\s\S]*?)<\/strong>\s*([\s\S]*?)<\/li>/g)) meta[cleanText(m[1])] = cleanText(m[2]);
    const categories = [...(block.match(/apply-result-category[\s\S]*?<\/div>/)?.[0] || '').matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map((m) => cleanText(m[1]));
    items.push({
      id: link[1],
      title: cleanText(link[2]),
      format: (block.match(/data-ext="([^"]+)"/) || [])[1] || null,
      category: categories[0] || null,
      provider: meta['제공기관'] || categories[1] || null,
      summary: cleanText((block.match(/class="apply-result-summary">([\s\S]*?)<\/span>/) || [])[1] || ''),
      applications: meta['활용신청'] || null,
      updated: meta['수정일'] || null,
      link: `${BASE}/data/${link[1]}/openapi.do`,
    });
  });
  return { total, items };
}

/**
 * @param {any} query
 * @param {import('./types.js').Options} [options]
 */
export async function searchDatasets(query, { page = 1, perPage = 10, fetchImpl = (url, init) => globalThis.fetch(url, init), timeoutMs = 15000 } = {}) {
  if (!String(query || '').trim()) throw new Error('검색어(query)가 필요합니다.');
  const url = `${BASE}/tcs/dss/selectDataSetList.do?dType=API&keyword=${encodeURIComponent(query)}&currentPage=${page}&perPage=${perPage}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0 datagokr-apply-mcp' }, signal: ctrl.signal });
  } finally { clearTimeout(timer); }
  if (!res.ok) throw new Error(`검색 페이지를 가져오지 못했어요(HTTP ${res.status}).`);
  return { url, ...parseSearchResults(await res.text()) };
}

// 개인회원이 개발단계에서 바로(자동승인) 쓸 수 있는 REST API 인가?
export function isAutoApprovable(spec) {
  if (!spec?.found && !spec?.title) return false;
  const rest = !spec.apiType || /REST/i.test(spec.apiType);
  const dev = String(spec.approval || '').match(/개발단계\s*:\s*([^/]+)/)?.[1] ?? String(spec.approval || '');
  return rest && /자동승인/.test(dev);
}

// 동시 실행 수를 제한하는 map
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * 키워드로 "개발단계 자동승인 REST" API 만 골라낸다 — 브라우저/로그인 없이 공개 페이지만 사용.
 * 검색 결과(최대 maxPages 페이지)의 각 상세 페이지를 4개씩 병렬로 읽어 필터링한다.
 */
/**
 * @param {any} keyword
 * @param {import('./types.js').Options} [options]
 */
export async function findApplyTargets(keyword, { limit = 10, maxPages = 3, concurrency = 4, fetchImpl } = {}) {
  const targets = [];
  const seen = new Set();
  let scanned = 0;
  for (let page = 1; page <= maxPages && targets.length < limit; page++) {
    const { items } = await searchDatasets(keyword, { page, fetchImpl });
    if (!items.length) break;
    const fresh = items.filter((it) => !seen.has(it.id));
    fresh.forEach((it) => seen.add(it.id));
    const specs = await mapLimit(fresh, concurrency, (it) => fetchApiSpec(it.id, { fetchImpl }).catch(() => null));
    fresh.forEach((it, i) => {
      scanned++;
      const spec = specs[i];
      if (spec && targets.length < limit && isAutoApprovable(spec)) {
        targets.push({
          id: it.id, name: it.title, provider: it.provider, applications: it.applications,
          traffic: spec.traffic, approval: spec.approval, hasEndpoint: Boolean(spec.endpoint),
        });
      }
    });
  }
  return { keyword, scanned, count: targets.length, targets };
}

export async function fetchApiSpec(id, { fetchImpl = (url, init) => globalThis.fetch(url, init), timeoutMs = 15000 } = {}) {
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
