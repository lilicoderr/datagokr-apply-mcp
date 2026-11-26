// MCP 도구 정의 — datago 클라이언트 + 레지스트리를 묶는다.
//
//   registerTools(server, { registry, fetchImpl }) 로 서버에 도구를 붙인다.
//   (fetchImpl 주입으로 테스트에서 네트워크 없이 검증)

import { callApi, describeResultCode, isEncodedKey, RESULT_CODES } from './datago.js';
import { extractItems, hasMore } from './items.js';

const APPLY_GUIDE = `공공데이터포털 오픈API '활용신청' 절차 (로그인 필요 — 자동화 불가):

1. https://www.data.go.kr 에 로그인한다.
2. 원하는 오픈API 상세 페이지에서 [활용신청] 을 누른다.
3. 활용목적을 적고 신청한다. (대부분 자동승인, 일부는 1~2일 심사)
4. 마이페이지 > 오픈API > 개발계정 에서 "일반 인증키(Encoding/Decoding)" 를 확인한다.
5. 그 키를 save_key 도구로 저장하면 call_api 에서 바로 쓸 수 있다.

주의:
- Encoding 키에는 %2B %2F 같은 문자가 들어 있고, Decoding 키는 +/= 등이 그대로 보인다.
- 이 서버는 둘 중 아무거나 저장해도 자동으로 인코딩을 맞춰 호출한다.
- 트래픽 제한(개발계정 보통 일 1,000회)을 넘기면 resultCode 22 가 난다.`;

function text(t) { return { content: [{ type: 'text', text: t }] }; }
function pretty(obj) { return text(typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)); }

// endpoint 별칭/직접 url + 키를 해석해 호출 준비물을 만든다 (call_api, fetch_all 공용)
function resolveCall(args, registry) {
  let url = args.url;
  let params = { ...(args.params || {}) };
  if (args.endpoint) {
    const ep = registry?.getEndpoint(args.endpoint);
    if (!ep) throw new Error(`저장된 엔드포인트가 없습니다: ${args.endpoint} (list_endpoints 로 확인)`);
    url = ep.url;
    params = { ...ep.params, ...params };
  }
  if (!url) throw new Error('url 또는 endpoint 가 필요합니다.');
  const serviceKey = args.serviceKey || registry?.getKey(args.keyName);
  if (!serviceKey) {
    throw new Error(args.keyName
      ? `저장된 키 '${args.keyName}' 가 없습니다. list_keys 로 확인하세요.`
      : '서비스 키가 없습니다. save_key 로 저장하거나 serviceKey 를 넘기세요. (apply_guide 참고)');
  }
  return { url, params, serviceKey, keyName: args.keyName || registry?.listKeys().defaultKey || 'direct' };
}

function summarizeResult(r) {
  const summary = {
    ok: r.ok,
    httpStatus: r.httpStatus,
    resultCode: r.resultCode ?? '(없음)',
    의미: r.codeMeaning || (r.ok ? '정상' : '알 수 없음'),
    resultMsg: r.resultMsg ?? null,
    응답형식: r.kind,
    키인코딩: r.usedEncodedKey ? 'Encoding' : 'Decoding',
    재시도됨: Boolean(r.retried),
    시도횟수: r.attempts ?? 1,
  };
  if (!r.ok && r.hint) summary.도움말 = r.hint;
  return summary;
}

export function registerTools(server, { registry, fetchImpl, usage, sleep } = {}) {
  // ── call_api : 핵심 도구 ──
  server.tool('call_api', {
    description: '공공데이터포털 오픈API 를 호출한다. url(또는 저장된 endpoint 별칭)과 params 를 주면 '
      + '서비스키를 자동으로 붙이고(이중 인코딩 자동 보정) 응답(JSON/XML)을 해석해 돌려준다.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '오픈API 엔드포인트 URL (http...). endpoint 를 주면 생략 가능' },
        endpoint: { type: 'string', description: '저장해 둔 엔드포인트 별칭 (save_endpoint 로 등록)' },
        params: { type: 'object', description: '쿼리 파라미터 (serviceKey 제외)' },
        keyName: { type: 'string', description: '사용할 저장된 키 이름 (없으면 기본 키)' },
        serviceKey: { type: 'string', description: '키를 직접 넘길 때 (저장 키 대신)' },
        method: { type: 'string', description: 'HTTP 메서드 (기본 GET)' },
        itemsOnly: { type: 'boolean', description: 'true 면 원본 대신 목록 항목(items)과 페이징 정보만 간추려 반환 (토큰 절약)' },
        maxItems: { type: 'number', description: 'itemsOnly 일 때 돌려줄 최대 항목 수 (기본 20)' },
      },
    },
  }, async (args) => {
    const { url, params, serviceKey, keyName } = resolveCall(args, registry);
    const r = await callApi({ url, params, serviceKey, method: args.method || 'GET', fetchImpl, sleep });
    usage?.record(keyName, { ok: r.ok });
    const 요약 = summarizeResult(r);
    if (args.itemsOnly) {
      const { items, ...page } = extractItems(r.data);
      const max = args.maxItems || 20;
      return pretty({ 요약, 페이징: page, 항목수: items.length, 항목: items.slice(0, max), 생략됨: Math.max(0, items.length - max) });
    }
    return pretty({ 요약, 데이터: r.data });
  });

  // ── fetch_all : 페이지 자동 순회 ──
  server.tool('fetch_all', {
    description: '페이지네이션이 있는 오픈API 를 pageNo 를 올려가며 모두(또는 maxPages 까지) 가져와 항목만 합쳐 돌려준다. '
      + '"전체 목록 줘", "2025년 공휴일 전부" 같은 요청에 쓴다. 호출당 트래픽이 소모되므로 maxPages 로 상한을 둔다.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' }, endpoint: { type: 'string' },
        params: { type: 'object', description: 'pageNo/numOfRows 는 자동 설정되므로 생략 가능' },
        keyName: { type: 'string' }, serviceKey: { type: 'string' },
        numOfRows: { type: 'number', description: '페이지당 항목 수 (기본 100)' },
        maxPages: { type: 'number', description: '최대 페이지 수 (기본 5, 상한 50)' },
        maxItems: { type: 'number', description: '응답에 담을 최대 항목 수 (기본 200)' },
      },
    },
  }, async (args) => {
    const { url, params, serviceKey, keyName } = resolveCall(args, registry);
    const numOfRows = args.numOfRows || 100;
    const maxPages = Math.min(Math.max(1, args.maxPages || 5), 50);
    const all = [];
    let totalCount = null;
    let pages = 0;
    let last;
    for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
      last = await callApi({ url, params: { ...params, pageNo, numOfRows }, serviceKey, fetchImpl, sleep });
      usage?.record(keyName, { ok: last.ok });
      pages++;
      if (!last.ok) break;
      const ex = extractItems(last.data);
      all.push(...ex.items);
      totalCount = ex.totalCount ?? totalCount;
      if (!hasMore({ ...ex, pageNo, numOfRows })) break;
    }
    const max = args.maxItems || 200;
    return pretty({
      요약: summarizeResult(last),
      조회페이지: pages,
      totalCount,
      가져온항목수: all.length,
      잘림: all.length > max || (totalCount != null && all.length < totalCount),
      항목: all.slice(0, max),
    });
  });

  server.tool('quota_status', {
    description: '오늘(KST) 이 서버로 호출한 횟수를 키별로 보여주고 개발계정 일일 한도(기본 1,000회) 대비 남은 양을 추정한다. '
      + '대량 호출 전에 확인하면 resultCode 22(한도 초과)를 피할 수 있다. (포털 실제 값이 아닌 로컬 집계)',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: '일일 한도 (기본 1000)' } } },
  }, async (a) => {
    if (!usage) return text('호출량 집계가 꺼져 있어요.');
    return pretty(usage.summary({ limit: a.limit || undefined }));
  });

  // ── 키 관리 ──
  server.tool('list_keys', { description: '저장된 서비스 키 목록(마스킹)과 기본 키를 보여준다.' },
    async () => pretty(registry.listKeys()));
  server.tool('save_key', {
    description: '서비스 키를 이름으로 저장한다. (Encoding/Decoding 아무 형태나 가능)',
    inputSchema: { type: 'object', required: ['name', 'key'], properties: {
      name: { type: 'string' }, key: { type: 'string' }, note: { type: 'string' },
    } },
  }, async (a) => {
    const r = registry.saveKey(a.name, a.key, a.note);
    return text(`키 '${r.name}' 저장${r.isDefault ? ' (기본 키로 설정)' : ''}. 형태: ${isEncodedKey(a.key) ? 'Encoding' : 'Decoding'}`);
  });
  server.tool('remove_key', { description: '저장된 키를 삭제한다.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
  }, async (a) => text(registry.removeKey(a.name) ? `키 '${a.name}' 삭제됨` : `키 '${a.name}' 없음`));
  server.tool('set_default_key', { description: '기본 키를 바꾼다.',
    inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
  }, async (a) => text(`기본 키: ${registry.setDefaultKey(a.name)}`));

  // ── 엔드포인트 관리 ──
  server.tool('list_endpoints', { description: '저장된 엔드포인트 별칭 목록.' },
    async () => pretty(registry.listEndpoints()));
  server.tool('save_endpoint', {
    description: '자주 쓰는 오픈API URL 을 별칭으로 저장한다. 기본 params 도 함께 저장 가능.',
    inputSchema: { type: 'object', required: ['alias', 'url'], properties: {
      alias: { type: 'string' }, url: { type: 'string' }, note: { type: 'string' }, params: { type: 'object' },
    } },
  }, async (a) => text(`엔드포인트 '${registry.saveEndpoint(a.alias, a.url, a.note, a.params)}' 저장됨`));
  server.tool('remove_endpoint', { description: '엔드포인트 별칭 삭제.',
    inputSchema: { type: 'object', required: ['alias'], properties: { alias: { type: 'string' } } },
  }, async (a) => text(registry.removeEndpoint(a.alias) ? `'${a.alias}' 삭제됨` : `'${a.alias}' 없음`));

  // ── 도움말 ──
  server.tool('explain_error', {
    description: '공공데이터포털 resultCode 를 사람이 읽을 설명으로 변환한다.',
    inputSchema: { type: 'object', required: ['code'], properties: { code: { type: 'string' } } },
  }, async (a) => text(`${a.code}: ${describeResultCode(a.code)}`));
  server.tool('list_error_codes', { description: '공공데이터포털 공통 resultCode 전체 표.' },
    async () => pretty(RESULT_CODES));
  server.tool('apply_guide', { description: '오픈API 활용신청(키 발급) 방법 안내. (로그인 필요, 자동화 불가)' },
    async () => text(APPLY_GUIDE));

  // ── 데이터셋 검색 (베스트 에포트: 포털 공개 검색) ──
  server.tool('search_datasets', {
    description: '공공데이터포털에서 키워드로 오픈API/데이터셋을 검색한다(공개 검색 기반, 베스트 에포트). '
      + '포털 구조 변경 시 동작하지 않을 수 있다.',
    inputSchema: { type: 'object', required: ['query'], properties: {
      query: { type: 'string' }, page: { type: 'number' },
    } },
  }, async (a) => {
    const fetchFn = fetchImpl || ((...x) => globalThis.fetch(...x));
    const page = a.page || 1;
    const url = `https://www.data.go.kr/tcs/dss/selectDataSetList.do?dType=API&keyword=${encodeURIComponent(a.query)}&currentPage=${page}&perPage=10`;
    try {
      const res = await fetchFn(url, { headers: { 'User-Agent': 'data-go-mcp' } });
      const html = await res.text();
      const items = extractDatasetCards(html);
      if (!items.length) {
        return text(`'${a.query}' 검색 결과를 파싱하지 못했어요. 포털에서 직접 확인: https://www.data.go.kr/tcs/dss/selectDataSetList.do?keyword=${encodeURIComponent(a.query)}`);
      }
      return pretty({ query: a.query, page, count: items.length, items });
    } catch (e) {
      return text(`검색 요청 실패: ${e.message}\n포털에서 직접 확인: https://www.data.go.kr/tcs/dss/selectDataSetList.do?keyword=${encodeURIComponent(a.query)}`);
    }
  });
}

// 검색 결과 HTML 에서 데이터셋 카드 추출 (베스트 에포트 파서)
export function extractDatasetCards(html) {
  const items = [];
  const re = /data-set-id="(\d+)"[\s\S]*?class="title"[^>]*>\s*([^<]+?)\s*</g;
  let m;
  while ((m = re.exec(html)) && items.length < 20) {
    items.push({ id: m[1], title: m[2].trim(), link: `https://www.data.go.kr/data/${m[1]}/openapi.do` });
  }
  // 대체 패턴: 상세 링크 href 기반
  if (items.length === 0) {
    const re2 = /href="\/data\/(\d+)\/openapi\.do"[^>]*>\s*([^<]+?)\s*</g;
    while ((m = re2.exec(html)) && items.length < 20) {
      const title = m[2].trim();
      if (title && !items.some((it) => it.id === m[1])) {
        items.push({ id: m[1], title, link: `https://www.data.go.kr/data/${m[1]}/openapi.do` });
      }
    }
  }
  return items;
}
