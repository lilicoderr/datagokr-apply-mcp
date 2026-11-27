// MCP 도구 정의 — datago 클라이언트 + 레지스트리를 묶는다.
//
//   registerTools(server, { registry, fetchImpl }) 로 서버에 도구를 붙인다.
//   (fetchImpl 주입으로 테스트에서 네트워크 없이 검증)

import { callApi as callApiRaw, describeResultCode, isEncodedKey, RESULT_CODES } from './datago.js';
import { extractItems, hasMore } from './items.js';
import { fetchApiSpec, buildExampleParams, searchDatasets, findApplyTargets } from './portal.js';
import { cacheKey } from './cache.js';
import { writeExport } from './export.js';
import { toTypeScript } from './hints.js';
import { assertSafeTarget } from './security.js';
import { createBreaker } from './breaker.js';
import { inferSchema } from './schema.js';
import { recommendDatasets } from './recommend.js';
import { structured } from './outputs.js';
import { registerGeoTools } from './tools-geo.js';
import { registerWatchTools } from './tools-watch.js';
import { annotateTools } from './annotations.js';

export const APPLY_GUIDE = `공공데이터포털 오픈API '활용신청' 절차 (로그인 필요 — 자동화 불가):

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
export const MAX_RAW_CHARS = 20000;
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
  assertSafeTarget(url);
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

export function registerTools(server, { registry, fetchImpl, usage, sleep, logger, cache, exportDir, breaker = createBreaker(), watchStore } = {}) {
  const callApi = (opts) => callApiRaw({ breaker, ...opts });
  // fetch_all / export_data 공용: pageNo 를 올리며 항목을 모은다
  async function collectPages(args, ctx) {
    const { url, params, serviceKey, keyName } = resolveCall(args, registry);
    const numOfRows = args.numOfRows || 100;
    const maxPages = Math.min(Math.max(1, args.maxPages || 5), 50);
    const all = [];
    let totalCount = null;
    let pages = 0;
    let last;
    for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
      ctx?.signal?.throwIfAborted();
      last = await callApi({ url, params: { ...params, pageNo, numOfRows }, serviceKey, fetchImpl, sleep, logger, signal: ctx?.signal });
      usage?.record(keyName, { ok: last.ok });
      pages++;
      ctx?.progress?.(pages, maxPages, `${pages}/${maxPages} 페이지 (${all.length + (last.ok ? extractItems(last.data).items.length : 0)}건)`);
      if (!last.ok) break;
      const ex = extractItems(last.data);
      all.push(...ex.items);
      totalCount = ex.totalCount ?? totalCount;
      if (!hasMore({ ...ex, pageNo, numOfRows })) break;
    }
    return { all, totalCount, pages, last };
  }

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
        cacheSeconds: { type: 'number', description: '같은 호출을 이 초 동안 캐시(성공 응답만, 트래픽 절약). 기본 0=끔' },
      },
    },
  }, async (args, ctx) => {
    const { url, params, serviceKey, keyName } = resolveCall(args, registry);
    const ttlMs = Math.max(0, Number(args.cacheSeconds) || 0) * 1000;
    const ck = cacheKey(url, params, keyName);
    let r = ttlMs && cache ? cache.get(ck) : undefined;
    const fromCache = Boolean(r);
    if (!r) {
      r = await callApi({ url, params, serviceKey, method: args.method || 'GET', fetchImpl, sleep, logger, signal: ctx?.signal });
      usage?.record(keyName, { ok: r.ok });
      if (r.ok && ttlMs && cache) cache.set(ck, r, ttlMs);
    }
    const 요약 = { ...summarizeResult(r), ...(fromCache ? { 캐시적중: true } : {}) };
    if (args.itemsOnly) {
      const { items, ...page } = extractItems(r.data);
      const max = args.maxItems || 20;
      return structured({ 요약, 페이징: page, 항목수: items.length, 항목: items.slice(0, max), 생략됨: Math.max(0, items.length - max) });
    }
    // 원본이 너무 크면 AI 컨텍스트를 잡아먹으므로 잘라서 돌려주고 대안을 안내
    const body = JSON.stringify({ 요약, 데이터: r.data }, null, 2);
    if (body.length > MAX_RAW_CHARS) {
      return { ...text(`${body.slice(0, MAX_RAW_CHARS)}
…(이하 ${body.length - MAX_RAW_CHARS}자 생략)
`
        + '※ 응답이 커서 잘랐어요. itemsOnly:true 로 항목만 받거나, 전체가 필요하면 fetch_all 을 쓰세요.'),
        structuredContent: { 요약, 잘림: true } };
    }
    return structured({ 요약, 데이터: r.data });
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
  }, async (args, ctx) => {
    const { all, totalCount, pages, last } = await collectPages(args, ctx);
    const max = args.maxItems || 200;
    return structured({
      요약: summarizeResult(last),
      조회페이지: pages,
      totalCount,
      가져온항목수: all.length,
      잘림: all.length > max || (totalCount != null && all.length < totalCount),
      항목: all.slice(0, max),
    });
  });

  // ── export_data : 전체 결과를 CSV/JSON 파일로 저장 (AI 컨텍스트를 쓰지 않고 대량 데이터 확보) ──
  server.tool('export_data', {
    description: 'fetch_all 과 같이 페이지를 순회해 항목을 모은 뒤 CSV(엑셀용 BOM)/JSON 파일로 저장하고 경로만 돌려준다. '
      + '수백~수천 건을 AI 컨텍스트에 싣지 않고 받아 가공할 때 쓴다. 파일은 내보내기 폴더(DATAGO_EXPORT_DIR, 기본 ~/datago-exports)에만 생성된다.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' }, endpoint: { type: 'string' }, params: { type: 'object' },
        keyName: { type: 'string' }, serviceKey: { type: 'string' },
        numOfRows: { type: 'number' }, maxPages: { type: 'number', description: '최대 페이지 (기본 5, 상한 50)' },
        format: { type: 'string', description: "'csv'(기본) 또는 'json'" },
        filename: { type: 'string', description: '파일 이름(확장자 제외, 폴더 지정 불가)' },
      },
    },
  }, async (args, ctx) => {
    const { all, totalCount, pages, last } = await collectPages(args, ctx);
    if (!all.length) {
      return text(`저장할 항목이 없어요. ${JSON.stringify(summarizeResult(last))}`);
    }
    const w = writeExport(all, { format: args.format || 'csv', name: args.filename || 'export', dir: exportDir });
    return structured({
      요약: summarizeResult(last), 저장됨: w.file, 행수: w.rows, 바이트: w.bytes, 조회페이지: pages, totalCount,
      잘림: totalCount != null && all.length < totalCount,
    });
  });

  // ── find_apply_targets : 신청 가능한(개인 자동승인 REST) API 고르기 — 공개 페이지만 사용 ──
  server.tool('find_apply_targets', {
    description: '키워드로 "개발단계 자동승인 REST" 오픈API 만 골라 id 목록을 준다(브라우저·로그인 불필요, 공개 페이지 기반). '
      + '"날씨 API 5개 신청해줘" 같은 요청에서 먼저 이걸로 대상을 찾고, 결과 ids 를 apply_apis 에 넘긴다.',
    inputSchema: { type: 'object', required: ['keyword'], properties: {
      keyword: { type: 'string', description: '검색어 (예: "날씨", "버스 도착", "미세먼지")' },
      limit: { type: 'number', description: '최대 개수 (기본 10, 상한 30)' },
    } },
  }, async (a) => {
    const r = await findApplyTargets(a.keyword, { limit: Math.min(a.limit || 10, 30), fetchImpl });
    if (!r.targets.length) {
      return text(`'${a.keyword}' 로 검색된 ${r.scanned}건 중 개발단계 자동승인 REST API 가 없어요. 다른 키워드로 시도하세요.`);
    }
    return pretty({
      keyword: r.keyword, 검토한건수: r.scanned, count: r.count,
      targets: r.targets.map((t) => ({ id: t.id, 이름: t.name, 기관: t.provider, 활용신청: t.applications, 트래픽: t.traffic })),
      다음: `apply_apis { ids: [${r.targets.map((t) => `"${t.id}"`).join(', ')}] } 로 한 번에 신청 (로그인 필요: apply_status)`,
    });
  });

  // ── describe_api : 호출 전에 정확한 명세 확인 (공개 페이지, 로그인 불필요) ──
  server.tool('describe_api', {
    description: '데이터 id(또는 상세 URL)로 오픈API 의 명세를 가져온다: 요청주소, 필수/선택 요청변수(샘플값), 응답 항목, '
      + '상세기능 목록, 일일 트래픽. call_api 를 부르기 전에 이걸로 정확한 url 과 필수 params 를 확인하라 '
      + '(추측으로 호출하다 resultCode 10/11/12 를 겪지 않도록). 로그인 불필요.',
    inputSchema: { type: 'object', required: ['idOrUrl'], properties: {
      idOrUrl: { type: 'string', description: '데이터 id (예 "15012690") 또는 data.go.kr/data/<id>/... URL' },
      saveAs: { type: 'string', description: '주면 이 요청주소를 해당 별칭으로 저장한다 (이후 call_api { endpoint: 별칭 } 로 호출)' },
    } },
  }, async (a) => {
    const spec = await fetchApiSpec(a.idOrUrl, { fetchImpl });
    if (!spec.found) {
      return text(`명세를 읽지 못했어요(LINK형/파일데이터이거나 포털 구조가 바뀌었을 수 있어요). 직접 확인: ${spec.pageUrl}`);
    }
    const example = spec.endpoint
      ? { url: spec.endpoint, params: buildExampleParams(spec.request) } : null;
    let saved = null;
    if (a.saveAs && spec.endpoint) {
      registry.saveEndpoint(a.saveAs, spec.endpoint, spec.title, {});
      saved = `별칭 '${a.saveAs}' 로 저장됨 → call_api { endpoint: "${a.saveAs}", params: {…필수 파라미터} }`;
    }
    return pretty({
      ...(saved ? { 저장: saved } : {}),
      제목: spec.title, 제공기관: spec.provider, 데이터포맷: spec.format, 트래픽: spec.traffic,
      요청주소: spec.endpoint, 서비스URL: spec.serviceUrl,
      상세기능: spec.operations.map((o) => o.name),
      ...(spec.operations.length > 1 ? { 참고: '요청주소는 첫 상세기능 기준이에요. 다른 기능은 서비스URL 뒤에 오퍼레이션명을 붙이며, 포털 페이지에서 확인하세요.' } : {}),
      요청변수: spec.request.map((r) => `${r.required ? '[필수]' : '[선택]'} ${r.name}(${r.ko}) 예:${r.sample || '-'} — ${r.desc}`),
      응답항목: spec.response.map((r) => `${r.name}(${r.ko})`),
      call_api_예시: example,
      상세페이지: spec.pageUrl,
    });
  });

  // ── api_types : 명세 → TypeScript 타입 (개발자가 코드에 바로 붙여넣기) ──
  server.tool('api_types', {
    description: '데이터 id(또는 상세 URL)의 명세를 읽어 요청 변수/응답 항목의 TypeScript 인터페이스를 생성한다. '
      + '앱 코드에 이 API 를 붙일 때 describe_api 대신 쓰면 바로 복사해 쓸 타입이 나온다. 로그인 불필요.',
    inputSchema: { type: 'object', required: ['idOrUrl'], properties: {
      idOrUrl: { type: 'string', description: '데이터 id 또는 data.go.kr/data/<id>/... URL' },
      name: { type: 'string', description: '타입 이름 접두사 (기본: API 제목)' },
    } },
  }, async (a) => {
    const spec = await fetchApiSpec(a.idOrUrl, { fetchImpl });
    if (!spec.found) return text(`명세를 읽지 못했어요. 직접 확인: ${spec.pageUrl}`);
    return text(`// ${spec.title} — ${spec.endpoint || spec.pageUrl}\n${toTypeScript(spec, { name: a.name })}`);
  });

  // ── infer_schema : 실제 응답으로 필드 타입/결측률 추정 ──
  server.tool('infer_schema', {
    description: '실제로 한 번 호출해서 응답 항목들의 필드별 타입(날짜/숫자문자열 등)·결측률·예시·enum 후보를 추정한다. '
      + '명세(describe_api)와 실제 응답이 다를 때나 데이터 파이프라인을 만들 때 쓴다. 1회 호출(트래픽 1) 소모.',
    inputSchema: { type: 'object', properties: {
      url: { type: 'string' }, endpoint: { type: 'string' }, params: { type: 'object' },
      keyName: { type: 'string' }, serviceKey: { type: 'string' },
      numOfRows: { type: 'number', description: '표본 크기 (기본 50)' },
    } },
  }, async (args) => {
    const { url, params, serviceKey, keyName } = resolveCall(args, registry);
    const r = await callApi({ url, params: { ...params, pageNo: 1, numOfRows: args.numOfRows || 50 }, serviceKey, fetchImpl, sleep, logger });
    usage?.record(keyName, { ok: r.ok });
    if (!r.ok) return pretty({ ...summarizeResult(r), 안내: '호출에 실패해 스키마를 추정하지 못했어요.' });
    const { items, totalCount } = extractItems(r.data);
    if (!items.length) return text('응답에 항목이 없어요. params 를 바꿔 다시 시도하세요.');
    return pretty({ totalCount, ...inferSchema(items) });
  });

  // ── batch_call : 같은 API 를 여러 params 로 호출 (호출 간격 제한) ──
  server.tool('batch_call', {
    description: '같은 API 를 paramsList 의 각 params 로 차례로 호출해 항목수/성공 여부를 모아 돌려준다 '
      + '(예: 여러 지역·월 조회). 호출 사이에 intervalMs 만큼 쉬어 트래픽 제한을 피하고, 실패하면 stopOnError 로 중단할 수 있다. '
      + '한 번에 최대 50건.',
    inputSchema: { type: 'object', required: ['paramsList'], properties: {
      url: { type: 'string' }, endpoint: { type: 'string' }, keyName: { type: 'string' }, serviceKey: { type: 'string' },
      params: { type: 'object', description: '모든 호출에 공통으로 붙는 params' },
      paramsList: { type: 'array', description: '호출별 params 배열 (최대 50)', items: { type: 'object' } },
      intervalMs: { type: 'number', description: '호출 간 대기(기본 200ms)' },
      stopOnError: { type: 'boolean' },
      maxItems: { type: 'number', description: '호출당 응답에 담을 최대 항목 (기본 5)' },
    } },
  }, async (args, ctx) => {
    const list = Array.isArray(args.paramsList) ? args.paramsList.slice(0, 50) : [];
    if (!list.length) throw new Error('paramsList 가 비어 있어요.');
    const { url, params, serviceKey, keyName } = resolveCall(args, registry);
    const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const gap = Math.max(0, args.intervalMs ?? 200);
    const results = [];
    for (let i = 0; i < list.length; i++) {
      ctx?.signal?.throwIfAborted();
      if (i > 0 && gap) await wait(gap);
      const r = await callApi({ url, params: { ...params, ...list[i] }, serviceKey, fetchImpl, sleep, logger, signal: ctx?.signal });
      ctx?.progress?.(i + 1, list.length, `${i + 1}/${list.length} 호출`);
      usage?.record(keyName, { ok: r.ok });
      const ex = extractItems(r.data);
      results.push({ params: list[i], ok: r.ok, resultCode: r.resultCode ?? null, totalCount: ex.totalCount,
        항목수: ex.items.length, 항목: ex.items.slice(0, args.maxItems ?? 5), ...(r.ok ? {} : { 도움말: r.hint }) });
      if (!r.ok && args.stopOnError) break;
    }
    const okCount = results.filter((x) => x.ok).length;
    return pretty({ 요청: list.length, 실행: results.length, 성공: okCount, 실패: results.length - okCount, 결과: results });
  });

  server.tool('quota_status', {
    description: '오늘(KST) 이 서버로 호출한 횟수를 키별로 보여주고 개발계정 일일 한도(기본 1,000회) 대비 남은 양을 추정한다. '
      + '대량 호출 전에 확인하면 resultCode 22(한도 초과)를 피할 수 있다. (포털 실제 값이 아닌 로컬 집계)',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: '일일 한도 (기본 1000)' } } },
  }, async (a) => {
    if (!usage) return structured({ day: '-', limit: 0, total: 0, byKey: {}, 안내: '호출량 집계가 꺼져 있어요.' });
    return structured(usage.summary({ limit: a.limit || undefined }));
  });

  // ── 키 관리 ──
  server.tool('list_keys', { description: '저장된 서비스 키 목록(마스킹)과 기본 키를 보여준다.' },
    async () => structured(registry.listKeys()));
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

  server.tool('recommend_datasets', {
    description: '자연어로 원하는 데이터를 설명하면(예: "내 동네 미세먼지 알려주는 API") 질의를 키워드로 나눠 포털을 여러 번 검색하고 '
      + '제목 일치·활용신청 수·JSON 지원 등으로 점수를 매겨 상위 후보를 추천한다. 다음은 describe_api.',
    inputSchema: { type: 'object', required: ['query'], properties: {
      query: { type: 'string', description: '원하는 데이터를 문장으로' },
      limit: { type: 'number', description: '추천 개수 (기본 5, 최대 10)' },
    } },
  }, async (a) => {
    const r = await recommendDatasets(a.query, { limit: Math.min(a.limit || 5, 10), fetchImpl });
    if (!r.recommendations.length) return text(`'${a.query}' 에 맞는 API 를 찾지 못했어요. 더 짧은 키워드로 search_datasets 를 써 보세요.`);
    return pretty({ ...r, 다음: '상위 항목의 id 로 describe_api 를 호출하세요.' });
  });

  // ── 데이터셋 검색 (베스트 에포트: 포털 공개 검색) ──
  server.tool('search_datasets', {
    description: '공공데이터포털에서 키워드로 오픈API 를 검색한다(로그인 불필요). 제목·분류·제공기관·요약·활용신청 수를 돌려준다. '
      + '대상을 고른 뒤 describe_api 로 명세를 확인하고 call_api 로 호출한다. 키가 없으면 apply_api 로 활용신청. '
      + '(포털 공개 검색 페이지 기반이라 구조 변경 시 동작하지 않을 수 있다)',
    inputSchema: { type: 'object', required: ['query'], properties: {
      query: { type: 'string', description: '검색어 (예: "버스 도착", "미세먼지")' },
      page: { type: 'number', description: '페이지 (기본 1, 페이지당 10건)' },
    } },
  }, async (a) => {
    const page = a.page || 1;
    const portalUrl = `https://www.data.go.kr/tcs/dss/selectDataSetList.do?dType=API&keyword=${encodeURIComponent(a.query)}`;
    try {
      const r = await searchDatasets(a.query, { page, fetchImpl });
      if (r.items.length) {
        return pretty({ query: a.query, page, 전체: r.total, count: r.items.length, items: r.items,
          다음: '마음에 드는 항목의 id 로 describe_api 를 호출해 요청주소/파라미터를 확인하세요.' });
      }
      return text(`'${a.query}' 검색 결과가 없거나 파싱하지 못했어요. 포털에서 직접 확인: ${portalUrl}`);
    } catch (e) {
      return text(`검색 요청 실패: ${e.message}\n포털에서 직접 확인: https://www.data.go.kr/tcs/dss/selectDataSetList.do?keyword=${encodeURIComponent(a.query)}`);
    }
  });
  registerGeoTools(server);
  registerWatchTools(server, { fetchImpl, store: watchStore });
  annotateTools(server);
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
