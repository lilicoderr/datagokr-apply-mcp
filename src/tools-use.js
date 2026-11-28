// use_api 도구 등록 (CLI `use` 도 createUse 를 같이 쓴다).
import * as applyDefault from './apply.js';
import { runUse } from './use.js';
import { createKeyRetriever } from './keystore.js';
import { createBreaker } from './breaker.js';
import { scrubKey } from './security.js';
import { annotateTools } from './annotations.js';
import { pinnedFetch } from './safefetch.js';

// 테스트 전용(DATAGO_BASE_URL, apply.js 와 같은 안전 조건): 명세 페이지도 로컬 가짜 포털에서 읽는다. 그 밖의 주소는 기본 클라이언트 그대로.
export function testPortalFetch(env = process.env) {
  if (!env.DATAGO_BASE_URL) return undefined;
  const base = applyDefault.resolveBaseUrl(env);
  return (url, init) => (String(url).startsWith('https://www.data.go.kr/')
    ? globalThis.fetch(base + String(url).slice('https://www.data.go.kr'.length), init)
    : pinnedFetch(String(url), init, { env }));
}

/** @param {import('./types.js').Options} deps  registry, apply, fetchImpl, usage, sleep, logger, breaker, now */
export function createUse(deps) {
  const apply = deps.apply || applyDefault;
  const { registry } = deps;
  const fetchImpl = deps.fetchImpl || testPortalFetch();
  const retrieveKey = createKeyRetriever(apply, registry);
  const breaker = deps.breaker || createBreaker();
  const running = new Set(); // 같은 id 를 동시에 두 번 돌려 중복 제출하는 것을 막는다

  /** @param {any} args @param {{ signal?: AbortSignal, progress?: (n: number, total?: number, msg?: string) => any }} [ctx] */
  return async function use(args, ctx = {}) {
    const id = applyDefault.extractDataPk(args.idOrUrl) || String(args.idOrUrl);
    if (running.has(id)) {
      return { ok: false, status: 'busy', dataId: id, message: '같은 API 의 use_api 가 아직 실행 중이에요(취소한 직후라면 마무리 중). 잠시 후 다시 실행하세요.',
        hint: 'use_api is already running for this id; retry shortly.', steps: [] };
    }
    running.add(id);
    try {
      const out = await runUse(args, { ...deps, fetchImpl, apply, retrieveKey, breaker, signal: ctx.signal, progress: ctx.progress });
      // 마지막 방어선: 저장된 어떤 키도(어떤 인코딩이든) 결과에 남지 않게 한다
      let json = JSON.stringify(out);
      for (const name of Object.keys(registry.listKeys().keys || {})) json = scrubKey(json, registry.getKey(name));
      return JSON.parse(json);
    } finally { running.delete(id); }
  };
}

export function formatUse(out) {
  const lines = [`[${out.status}] ${out.title ? `${out.title}\n` : ''}${out.message}`];
  if (out.plan && !out.ok) {
    lines.push('', `신청 계획: ${out.plan.title} (id ${out.plan.dataId})`, `  활용목적: ${out.plan.purpose}`,
      `  승인 방식: ${out.plan.approval || '미확인'}${out.plan.autoApprove ? '' : ' — 자동승인이 아닐 수 있어요'}`);
  }
  if (out.test) lines.push('', `시험 호출: resultCode ${out.test.resultCode ?? '(없음)'} ${out.test.message || ''}`.trimEnd());
  if (out.example) {
    lines.push('', `call_api ${JSON.stringify(out.example.call_api)}`, '', out.example.curl, '', out.example.js, '', out.example.env);
  }
  if (out.next) lines.push('', `다음 단계: ${out.next}`);
  return lines.join('\n');
}

export const USE_DESCRIPTION = '[원클릭] 데이터 id 하나로 핵심 흐름을 끝까지: 명세 읽기 → (키가 안 되면) 활용신청 → 인증키 저장(덮어쓰지 않음) → '
  + '샘플값으로 시험 호출 → 별칭 저장 → 실행 예시(call_api 인자, curl, JS; 키는 환경변수 자리표시자) 반환. '
  + '활용신청 제출은 사용자의 포털 계정을 바꾸므로 confirm:true 일 때만 한다: 먼저 confirm 없이(또는 dryRun:true) 불러 plan 을 사용자에게 보여주고, '
  + '동의를 받은 뒤에만 confirm:true 로 다시 부른다. 다시 실행하면 멈춘 곳부터 이어 간다. '
  + 'status: ready | needs_confirm | needs_login(apply_login) | pending_activation(retryAfter 이후 재실행) | need_params | needs_key | call_failed | apply_failed | unsupported | blocked_host | needs_setup | dry_run. '
  + '(신청·인증키 자동 수집은 실제 포털에서 아직 검증되지 않았다)';

/** @param {any} server @param {import('./types.js').Options} [options] */
export function registerUseTool(server, options = {}) {
  const use = createUse(options);
  server.tool('use_api', {
    description: USE_DESCRIPTION,
    inputSchema: { type: 'object', required: ['idOrUrl'], properties: {
      idOrUrl: { type: 'string', description: '데이터 id (예 "15012690") 또는 data.go.kr 데이터 URL' },
      confirm: { type: 'boolean', description: 'true 일 때만 활용신청을 실제로 제출. 사용자 동의를 받은 뒤에 쓴다' },
      dryRun: { type: 'boolean', description: 'true 면 할 일만 보여주고 신청·저장·API 호출을 하지 않음(confirm 보다 우선)' },
      operation: { type: 'string', description: '상세기능 id 또는 이름 일부 (describe_api 와 동일)' },
      params: { type: 'object', description: '샘플값 대신/추가로 쓸 요청 변수 (serviceKey 제외)' },
      keyName: { type: 'string', description: '사용/저장할 키 이름 (기본: 기본 키, 새로 저장할 땐 "datago")' },
      alias: { type: 'string', description: '저장할 엔드포인트 별칭 (기본 "api-<id>")' },
      purpose: { type: 'string', description: '활용목적 (신청할 때)' },
      reapply: { type: 'boolean', description: '이전 신청 기록을 무시하고 다시 신청(키가 거부되고 신청 내역이 없을 때만, confirm 필요)' },
      showBrowser: { type: 'boolean', description: '브라우저 창을 보며 진행(디버그)' },
    } },
  }, async (a, ctx) => {
    // confirm 은 정확히 boolean true 만 인정한다
    const out = await use({ ...a, confirm: a.confirm === true, dryRun: Boolean(a.dryRun) && a.dryRun !== 'false' }, ctx);
    return { content: [{ type: 'text', text: formatUse(out) }], structuredContent: out, ...(out.status === 'invalid_input' ? { isError: true } : {}) };
  });
  annotateTools(server);
}
