// MCP 도구 정의 — datago 클라이언트 + 레지스트리를 묶는다.
//
//   registerTools(server, { registry, fetchImpl }) 로 서버에 도구를 붙인다.
//   (fetchImpl 주입으로 테스트에서 네트워크 없이 검증)

import { callApi as callApiRaw, describeResultCode, isEncodedKey, RESULT_CODES } from './datago.js';
import { extractItems, hasMore } from './items.js';
import { fetchApiSpec, buildExampleParams, searchDatasets, findApplyTargets } from './portal.js';
import { cacheKey } from './cache.js';
import { writeExport } from './export.js';
import { assertSafeTargetResolved } from './security.js';
import { createBreaker } from './breaker.js';
import { structured } from './outputs.js';
import { annotateTools } from './annotations.js';

export const APPLY_GUIDE = `공공데이터포털 오픈API 활용신청 → 키 발급 → 호출 흐름 (이 서버가 처음부터 끝까지 자동화한다):

1. apply_status 로 로그인 세션을 확인한다. 없으면 apply_login 으로 창을 띄우고, 사용자가 그 창에서 직접 로그인한다(비밀번호는 저장하지 않음).
2. find_apply_targets(자동승인 REST 만 골라 줌) 또는 search_datasets 로 대상을 찾고, describe_api 로 요청 변수를 확인한다.
3. apply_api 로 활용신청한다. 여러 개면 ids 배열로 한 번에. 개인 자동승인 API 는 바로 승인된다.
4. 승인 뒤 일반 인증키(Encoding/Decoding)를 마이페이지에서 자동으로 읽어 save_key 로 저장한다(apply_get_key 로 다시 시도 가능).
5. call_api 로 호출한다. 키는 자동으로 붙고 Encoding/Decoding 어느 쪽이든 인코딩이 보정된다.

수동으로 할 때: data.go.kr 로그인 → API 상세 페이지 [활용신청] → 마이페이지 > 오픈API > 개발계정에서 인증키 확인 → save_key.
트래픽 제한(개발계정 보통 일 1,000회)을 넘기면 resultCode 22 가 난다. 막히면 doctor 를 실행하라.`;

function text(t) { return { content: [{ type: 'text', text: t }] }; }
export const MAX_RAW_CHARS = 20000;
function pretty(obj) { return text(typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)); }
// endpoint 별칭/직접 url + 키를 해석해 호출 준비물을 만든다 (call_api, fetch_all 공용)
// describe_api 가 읽은 명세를 기억해 두었다가 call_api 호출 전에 필수 변수 누락을 잡는다 (프로세스 메모리)
const specCache = new Map();
const specKey = (u) => String(u || '').split('?')[0].replace(/\/+$/, '');

/** @param {any} url @param {any} params @param {{ required?: string[], ignore?: string[] }} [opts] */
export function checkParams(url, params, opts = {}) {
export function checkParams(url, params, { required: saved, ignore = [] } = {}) {
  const spec = specCache.get(specKey(url));
  const required = saved || spec?.required;
  if (!required) return null;
  const have = new Set(Object.entries(params).filter(([, v]) => v !== '' && v != null).map(([k]) => k.toLowerCase()));
  const missing = required.filter((n) => !have.has(n.toLowerCase()) && !ignore.includes(n));
  const known = spec ? new Set(spec.names.map((n) => n.toLowerCase())) : null;
  const unknown = known ? Object.keys(params).filter((k) => !known.has(k.toLowerCase()) && !ignore.includes(k)) : [];
  return { missing, unknown };
}

const missingMessage = (m) => `필수 요청변수가 빠졌어요: ${m.join(', ')}. 호출하면 resultCode 11 이 나고 트래픽만 소모돼서 호출하지 않았어요. params 에 추가하세요(예시는 describe_api 의 callExample).`;
const MISSING_HINT = 'Required request parameters are missing; call skipped to save quota. Add them to params, or pass skipValidation:true to call anyway.';

// endpoint 별칭/직접 url + 키를 해석해 호출 준비물을 만든다 (call_api, fetch_all 공용)
async function resolveCall(args, registry) {
  let url = args.url;
  let params = { ...(args.params || {}) };
  let ep = null;
  if (args.endpoint) {
    ep = registry?.getEndpoint(args.endpoint);
    if (!ep) throw new Error(`저장된 엔드포인트가 없습니다: ${args.endpoint} (list_endpoints 로 확인)`);
    url = ep.url;
    params = { ...ep.params, ...params };
  }
  if (!url) throw new Error('url 또는 endpoint 가 필요합니다.');
  await assertSafeTargetResolved(url);
  // params 안에 serviceKey 를 넣은 경우: 쿼리에 두 번 붙으면 resultCode 30 이 나므로 꺼내서 키로 쓴다
  let inlineKey;
  for (const k of Object.keys(params)) if (k.toLowerCase() === 'servicekey') { inlineKey = params[k]; delete params[k]; }
  const serviceKey = args.serviceKey || inlineKey || registry?.getKey(args.keyName);
  if (!serviceKey) {
    throw new Error(args.keyName
      ? `저장된 키 '${args.keyName}' 가 없습니다. list_keys 로 확인하세요.`
      : '서비스 키가 없습니다. save_key 로 저장하거나 serviceKey 를 넘기세요. (키가 없으면 apply_api 로 활용신청하세요)');
  }
  return { url, params, serviceKey, keyName: args.keyName || registry?.listKeys().defaultKey || 'direct', required: ep?.required };
}

function summarizeResult(r) {
  const summary = {
    ok: r.ok,
    httpStatus: r.httpStatus,
    resultCode: r.resultCode ?? '(없음)',
    meaning: r.codeMeaning || (r.ok ? '정상' : '알 수 없음'),
    message: r.resultMsg ?? null,
    format: r.kind,
    keyEncoding: r.usedEncodedKey ? 'Encoding' : 'Decoding',
    retried: Boolean(r.retried),
    attempts: r.attempts ?? 1,
  };
  if (!r.ok && r.hint) summary.hint = r.hint;
  return summary;
}

/**
 * @param {any} server
 * @param {import('./types.js').Options} [options]
 */
export function registerTools(server, { registry, fetchImpl, usage, sleep, logger, cache, exportDir, breaker = createBreaker() } = {}) {
  const callApi = (opts) => callApiRaw({ breaker, ...opts });
  // fetch_all / export_data 공용: pageNo 를 올리며 항목을 모은다
  async function collectPages(args, ctx) {
    const { url, params, serviceKey, keyName, required } = await resolveCall(args, registry);
    const pre = checkParams(url, params, { required, ignore: ['pageNo', 'numOfRows'] });
    if (pre?.missing.length && !args.skipValidation) {
      throw Object.assign(new Error(missingMessage(pre.missing)), { hint: MISSING_HINT });
    }
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
        itemsOnly: { type: 'boolean', description: 'true 면 원본 대신 목록 항목(items)과 페이징 정보만 간추려 반환 (토큰 절약)' },
        maxItems: { type: 'number', description: 'itemsOnly 일 때 돌려줄 최대 항목 수 (기본 20)' },
        skipValidation: { type: 'boolean', description: 'true 면 describe_api 로 알게 된 필수 변수 누락 검사를 건너뛰고 그대로 호출(기본 false)' },
        cacheSeconds: { type: 'number', description: '같은 호출을 이 초 동안 캐시(성공 응답만, 트래픽 절약). 기본 0=끔' },
      },
    },
  }, async (args, ctx) => {
    const { url, params, serviceKey, keyName, required } = await resolveCall(args, registry);
    const pre = checkParams(url, params, { required });
    if (pre?.missing.length && !args.skipValidation) {
      return structured({ summary: {
        ok: false, skipped: true, resultCode: '(미호출)', meaning: '필수 요청변수 누락', message: missingMessage(pre.missing),
        missing: pre.missing, hint: MISSING_HINT,
      } });
    }
    const warnings = pre?.unknown.length
      ? [`명세에 없는 변수예요(오타 확인): ${pre.unknown.join(', ')}`] : [];
    const ttlMs = Math.max(0, Number(args.cacheSeconds) || 0) * 1000;
    const ck = cacheKey(url, params, keyName);
    let r = ttlMs && cache ? cache.get(ck) : undefined;
    const fromCache = Boolean(r);
    if (!r) {
      r = await callApi({ url, params, serviceKey, fetchImpl, sleep, logger, signal: ctx?.signal });
      usage?.record(keyName, { ok: r.ok });
      if (r.ok && ttlMs && cache) cache.set(ck, r, ttlMs);
    }
    const summary = { ...summarizeResult(r), ...(fromCache ? { cached: true } : {}), ...(warnings.length ? { warnings } : {}) };
    if (args.itemsOnly) {
      const { items, ...page } = extractItems(r.data);
      const max = args.maxItems || 20;
      return structured({ summary, paging: page, count: items.length, items: items.slice(0, max), omitted: Math.max(0, items.length - max) });
    }
    // 원본이 너무 크면 AI 컨텍스트를 잡아먹으므로 잘라서 돌려주고 대안을 안내
    const body = JSON.stringify({ summary, data: r.data }, null, 2);
    if (body.length > MAX_RAW_CHARS) {
      return { ...text(`${body.slice(0, MAX_RAW_CHARS)}
…(이하 ${body.length - MAX_RAW_CHARS}자 생략)
`
        + '※ 응답이 커서 잘랐어요. itemsOnly:true 로 항목만 받거나, 전체가 필요하면 fetch_all 을 쓰세요.'),
        structuredContent: { summary, truncated: true } };
    }
    return structured({ summary, data: r.data });
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
      summary: summarizeResult(last),
      pages,
      totalCount,
      count: all.length,
      truncated: all.length > max || (totalCount != null && all.length < totalCount),
      items: all.slice(0, max),
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
      return structured({ summary: summarizeResult(last), savedTo: null, rows: 0, bytes: 0, pages, totalCount, truncated: false, message: '저장할 항목이 없어요.' });
    }
    const w = writeExport(all, { format: args.format || 'csv', name: args.filename || 'export', dir: exportDir });
    return structured({
      summary: summarizeResult(last), savedTo: w.file, rows: w.rows, bytes: w.bytes, pages, totalCount,
      truncated: totalCount != null && all.length < totalCount,
    });
  });

  // ── find_apply_targets : 신청 가능한(개인 자동승인 REST) API 고르기 — 공개 페이지만 사용 ──
  server.tool('find_apply_targets', {
    description: '키워드로 "개발단계 자동승인 REST" 오픈API 만 골라 id 목록을 준다(브라우저·로그인 불필요, 공개 페이지 기반). '
      + '"날씨 API 5개 신청해줘" 같은 요청에서 먼저 이걸로 대상을 찾고, 결과 ids 를 apply_api 의 ids 에 넘긴다.',
    inputSchema: { type: 'object', required: ['keyword'], properties: {
      keyword: { type: 'string', description: '검색어 (예: "날씨", "버스 도착", "미세먼지")' },
      limit: { type: 'number', description: '최대 개수 (기본 10, 상한 30)' },
    } },
  }, async (a) => {
    const r = await findApplyTargets(a.keyword, { limit: Math.min(a.limit || 10, 30), fetchImpl });
    if (!r.targets.length) {
      return structured({
        keyword: r.keyword, scanned: r.scanned, count: 0, targets: [],
        message: r.scanned
          ? `'${a.keyword}' 로 검색된 ${r.scanned}건 중 개발단계 자동승인 REST API 가 없어요. 더 일반적인 키워드로 시도하거나 search_datasets 로 직접 고르세요.`
          : `'${a.keyword}' 검색 결과가 없어요. 철자를 확인하거나 더 짧은 키워드로 시도하세요.`,
        hint: 'No auto-approval REST targets; broaden the keyword or use search_datasets.',
      });
    }
    return pretty({
      keyword: r.keyword, scanned: r.scanned, count: r.count,
      targets: r.targets.map((t) => ({ id: t.id, name: t.name, provider: t.provider, applications: t.applications, traffic: t.traffic })),
      next: `apply_api { ids: [${r.targets.map((t) => `"${t.id}"`).join(', ')}] } 로 한 번에 신청 (로그인 필요: apply_status)`,
    });
  });

  // ── describe_api : 호출 전에 정확한 명세 확인 (공개 페이지, 로그인 불필요) ──
  server.tool('describe_api', {
    description: '데이터 id(또는 상세 URL)로 오픈API 의 명세를 가져온다: 요청주소, 필수/선택 요청변수(샘플값), 응답 항목, '
      + '상세기능 목록, 일일 트래픽. call_api 를 부르기 전에 이걸로 정확한 url 과 필수 params 를 확인하라 '
      + '(추측으로 호출하다 resultCode 10/11/12 를 겪지 않도록). 로그인 불필요.',
    inputSchema: { type: 'object', required: ['idOrUrl'], properties: {
      idOrUrl: { type: 'string', description: '데이터 id (예 "15012690") 또는 data.go.kr/data/<id>/... URL' },
      operation: { type: 'string', description: '상세기능 id 또는 이름 일부(예 "공휴일"). 생략하면 첫 기능 기준. 기능마다 요청주소/변수가 다르니 operations 를 보고 고른다' },
      saveAs: { type: 'string', description: '주면 이 요청주소를 해당 별칭으로 저장한다 (이후 call_api { endpoint: 별칭 } 로 호출)' },
    } },
  }, async (a) => {
    const spec = await fetchApiSpec(a.idOrUrl, { fetchImpl, operation: a.operation });
    if (!spec.found) {
      const notRest = spec.reason === 'not_rest';
      return structured({
        found: false, reason: spec.reason || 'no_spec', pageUrl: spec.pageUrl,
        message: notRest
          ? `이 데이터는 REST 오픈API 가 아니에요(유형: ${spec.apiType}). 포털 페이지에서 직접 확인하세요: ${spec.pageUrl}`
          : `명세를 읽지 못했어요. LINK형·파일데이터이거나 포털 구조가 바뀌었을 수 있어요. 포털 페이지에서 직접 확인하세요: ${spec.pageUrl}`,
        hint: notRest ? 'Not a REST OpenAPI; call_api does not apply. Open pageUrl.'
          : 'No request spec parsed (LINK/file data or layout change). Try find_apply_targets or open pageUrl.',
      });
    }
    if (spec.endpoint) {
      specCache.set(specKey(spec.endpoint), { required: spec.request.filter((r) => r.required).map((r) => r.name), names: spec.request.map((r) => r.name) });
    }
    const example = spec.endpoint
      ? { url: spec.endpoint, params: buildExampleParams(spec.request) } : null;
    let saved = null;
    if (a.saveAs && spec.endpoint) {
      registry.saveEndpoint(a.saveAs, spec.endpoint, spec.title, {}, spec.request.filter((r) => r.required).map((r) => r.name));
      saved = `별칭 '${a.saveAs}' 로 저장됨 → call_api { endpoint: "${a.saveAs}", params: {…필수 파라미터} }`;
    }
    return pretty({
      ...(saved ? { saved } : {}),
      title: spec.title, provider: spec.provider, format: spec.format, traffic: spec.traffic,
      endpoint: spec.endpoint, serviceUrl: spec.serviceUrl,
      operations: spec.operations.map((o) => o.name),
      ...(spec.operation ? { operation: spec.operation.name } : {}),
      ...(spec.operations.length > 1 && !spec.operation ? { note: '요청주소는 첫 상세기능 기준이에요. 다른 기능은 operation 인자(예: operation: "' + spec.operations[1].name + '")로 다시 조회하세요.' } : {}),
      request: spec.request.map((r) => `${r.required ? '[필수]' : '[선택]'} ${r.name}(${r.ko}) 예:${r.sample || '-'} — ${r.desc}`),
      response: spec.response.map((r) => `${r.name}(${r.ko})`),
      callExample: example,
      pageUrl: spec.pageUrl,
    });
  });

  server.tool('quota_status', {
    description: '오늘(KST) 이 서버로 호출한 횟수를 키별로 보여주고 개발계정 일일 한도(기본 1,000회) 대비 남은 양을 추정한다. '
      + '대량 호출 전에 확인하면 resultCode 22(한도 초과)를 피할 수 있다. (포털 실제 값이 아닌 로컬 집계)',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: '일일 한도 (기본 1000)' } } },
  }, async (a) => {
    if (!usage) return structured({ day: '-', limit: 0, total: 0, byKey: {}, message: '호출량 집계가 꺼져 있어요.' });
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
    description: '공공데이터포털 resultCode 를 사람이 읽을 설명으로 변환한다. code 를 생략하면 공통 resultCode 전체 표를 돌려준다.',
    inputSchema: { type: 'object', properties: { code: { type: 'string' } } },
  }, async (a) => (a.code ? text(`${a.code}: ${describeResultCode(a.code)}`) : pretty(RESULT_CODES)));

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
        return pretty({ query: a.query, page, total: r.total, count: r.items.length, items: r.items,
          next: '마음에 드는 항목의 id 로 describe_api 를 호출해 요청주소/파라미터를 확인하세요.' });
      }
      return structured({ query: a.query, page, total: r.total ?? 0, count: 0, items: [], portalUrl,
        message: r.total === 0 ? `'${a.query}' 검색 결과가 없어요. 더 짧거나 일반적인 키워드로 시도하세요.`
          : `'${a.query}' 검색 결과를 읽지 못했어요(페이지 번호 초과이거나 포털 구조 변경). 포털에서 직접 확인: ${portalUrl}`,
        hint: r.total === 0 ? 'No results; try a shorter keyword.' : 'Results unparsed (page beyond last, or portal layout changed); open portalUrl.' });
    } catch (e) {
      return structured({ query: a.query, page, count: 0, items: [], portalUrl, message: `검색 요청 실패: ${e.message}`,
        hint: e.hint || 'Search request failed; retry or open portalUrl.' });
    }
  });
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
