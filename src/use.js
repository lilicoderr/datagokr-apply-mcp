// use_api: 검색 뒤의 핵심 흐름(명세 → 신청 → 키 → 시험 호출 → 별칭 → 예시)을 한 번에.
// 다시 실행하면 이어서 한다(registry 의 flow 기록 + 저장된 키). 계정을 바꾸는 신청 제출은 confirm:true 일 때만.
import { extractDataPk } from './apply.js';
import { fetchApiSpec, isAutoApprovable } from './portal.js';
import { callApi } from './datago.js';
import { extractItems } from './items.js';
import { assertSafeTargetResolved, scrubKey } from './security.js';
import { buildExample } from './example.js';
import { prepareParams, classifyTest, retryPlan, saveAlias } from './use-helpers.js';
import { createOutcomes } from './use-outcomes.js';

export const TOTAL_STEPS = 5;

/**
 * @param {import('./types.js').Options} args  idOrUrl, operation, params, confirm, dryRun, reapply, keyName, alias, purpose, showBrowser
 * @param {import('./types.js').Options} deps  registry, apply, retrieveKey, fetchImpl, usage, sleep, logger, breaker, signal, progress, now
 */
export async function runUse(args, deps) {
  const { registry, apply, retrieveKey, fetchImpl, signal, progress, now = Date.now } = deps;
  const pk = extractDataPk(args.idOrUrl);
  const ctx = { args, pk, steps: [], spec: null, params: {}, secrets: new Set() };
  const out = createOutcomes(ctx);
  const step = (n, msg) => { signal?.throwIfAborted(); progress?.(n, TOTAL_STEPS, msg); };
  const log = (name, status, detail) => ctx.steps.push({ step: name, status, ...(detail ? { detail } : {}) });
  if (!pk) return out.invalid();

  // 1) 명세
  step(1, '명세 읽는 중');
  const spec = await fetchApiSpec(pk, { fetchImpl, operation: args.operation });
  signal?.throwIfAborted();
  ctx.spec = spec;
  if (!spec.found || !spec.endpoint) return out.unsupported();
  try { await assertSafeTargetResolved(spec.endpoint); } catch (e) { return out.blockedHost(e.message); }
  log('spec', 'done', spec.endpoint);
  const prepared = prepareParams(spec.request, args.params);
  ctx.params = prepared.params;
  ctx.droppedKey = prepared.droppedKey;
  const { missing } = prepared;

  let flow = registry.getFlow(pk);
  const requested = args.keyName || null;
  const exists = (n) => Boolean(n && registry.getKey(n));
  // 지난 실행에서 저장한 키가 있으면 그 키로 이어 간다
  let name = flow?.keyName && (flow.requestedKeyName ?? null) === requested && exists(flow.keyName)
    ? flow.keyName : [requested || registry.listKeys().defaultKey].find(exists) || null;
  const applied = () => Boolean(flow?.appliedAt) && !(args.reapply && !ctx.submitted);

  if (args.dryRun) return out.dryRun({ name, applied: applied(), missing, apply, autoApprove: isAutoApprovable(spec) });

  async function testCall() {
    step(4, '시험 호출 중');
    const serviceKey = registry.getKey(name);
    ctx.secrets.add(serviceKey);
    try {
      const r = await callApi(/** @type {any} */ ({
        url: spec.endpoint, params: ctx.params, serviceKey, fetchImpl, signal,
        sleep: deps.sleep, logger: deps.logger, breaker: deps.breaker,
      }));
      signal?.throwIfAborted();
      deps.usage?.record(name, { ok: r.ok });
      return { name, kind: classifyTest(r), r, items: r.ok ? extractItems(r.data).items.slice(0, 3) : [] };
    } catch (e) {
      if (signal?.aborted) throw signal.reason ?? e;
      return { name, kind: 'failed', r: null, items: [], error: scrubKey(e.message, serviceKey) };
    }
  }

  // 시험 호출 결과를 최종 응답으로. 별칭·예시는 ready 와 pending 에서만 저장/제공한다.
  function finish(test) {
    log('test_call', test.kind);
    if (test.kind === 'failed') return out.callFailed(test, name);
    step(5, '별칭 저장 중');
    const alias = saveAlias(registry, args.alias || `api-${pk}${spec.operation ? `-${spec.operation.id}` : ''}`, spec);
    log('alias', alias ? 'done' : 'skipped', alias);
    const keyName = name === registry.listKeys().defaultKey ? null : name;
    const example = buildExample({ url: spec.endpoint, params: ctx.params, alias, keyName });
    if (test.kind === 'inactive') {
      return out.pending({ test, alias, example, keyName: name, applied: applied(), retry: retryPlan(flow?.appliedAt, now()) });
    }
    flow = registry.saveFlow(pk, { keyName: name, requestedKeyName: requested, verifiedAt: new Date(now()).toISOString() });
    return out.ready({ test, alias, example, keyName: name });
  }

  // 2) 저장된 키가 있으면 먼저 써 본다 — 되면 신청할 필요가 없다
  let first = null;
  if (name) {
    log('key', 'found', name);
    if (missing.length) return out.needParams(missing, name);
    first = await testCall();
    if (first.kind !== 'inactive') return finish(first);
    if (applied() && flow.keyName === name) return finish(first); // 신청·키 저장까지 끝남 → 승인 반영 대기
  }

  // 3) 활용신청 (이미 제출한 기록이 있으면 건너뜀)
  step(2, '활용신청 확인 중');
  if (!applied()) {
    const gate = await out.loginGate(apply, signal);
    if (gate) return gate;
    if (args.confirm !== true) return out.needConfirm({ name, first, autoApprove: isAutoApprovable(spec) });
    signal?.throwIfAborted();
    const r = await apply.applyForApis([pk], { purpose: args.purpose, headless: !args.showBrowser, signal, delayMs: 0 });
    if (r.needLogin) return out.needLogin();
    if (r.done || r.already) {
      // 취소됐더라도 제출 사실은 먼저 기록해야 다시 실행할 때 이어진다
      ctx.submitted = true;
      flow = registry.saveFlow(pk, { appliedAt: new Date(now()).toISOString(), already: !r.done, keyName: null, requestedKeyName: requested });
      log('apply', r.done ? 'submitted' : 'already_applied');
    } else {
      signal?.throwIfAborted();
      return out.applyFailed(r.results?.[0]?.message || r.results?.[0]?.error);
    }
  } else log('apply', 'skipped', `이전 기록: ${flow.appliedAt}`);

  // 4) 인증키 저장 (덮어쓰지 않는 검증된 수집 경로)
  step(3, '인증키 확인 중');
  if (!name || flow.keyName !== name) {
    let key = null;
    if (apply.isAvailable()) {
      key = await retrieveKey({ headless: !args.showBrowser, keyName: requested || undefined });
      signal?.throwIfAborted();
    }
    if (key?.ok && key.keyName) {
      if (key.keyName !== name) first = null;
      name = key.keyName;
      flow = registry.saveFlow(pk, { keyName: name, requestedKeyName: requested });
      log('get_key', key.saved ? 'saved' : 'already_stored', name);
    } else {
      log('get_key', 'failed', key?.message);
      if (!name) return key?.needLogin ? out.needLogin() : out.needKey(key?.message);
    }
  }
  if (missing.length) return out.needParams(missing, name);
  // 방금 신청했다면 같은 키라도 다시 불러 본다
  return finish(!ctx.submitted && first?.name === name ? first : await testCall());
}
