// use_api 의 상태별 응답. 모두 { ok, status, message(한국어), hint(영어), next?, steps } 모양이고 ok 는 ready 일 때만 true.
import { DEFAULT_PURPOSE } from './apply.js';

const summaryOf = (t) => ({
  ok: t.kind === 'ok', resultCode: t.r?.resultCode ?? null, httpStatus: t.r?.httpStatus ?? null,
  message: t.r?.resultMsg ?? t.error ?? null, meaning: t.r?.codeMeaning ?? null,
});

export function createOutcomes(ctx) {
  const { args, pk } = ctx;
  const again = (extra = '') => `use_api { idOrUrl: "${pk}"${extra} } (같은 인자로 다시 실행하면 이어서 진행)`;
  const make = (status, message, hint, next, extra = {}) => ({
    ok: status === 'ready', status, dataId: pk, title: ctx.spec?.title ?? null,
    message: ctx.droppedKey ? `${message}\n※ params 의 serviceKey 는 무시했어요(저장된 키를 사용).` : message,
    hint, ...(next ? { next } : {}), steps: ctx.steps, ...extra,
  });
  const plan = (autoApprove) => ({
    action: '개발계정 활용신청 제출 (data.go.kr 계정에 신청 내역이 생김)', dataId: pk, title: ctx.spec.title,
    purpose: String(args.purpose || '').trim() || DEFAULT_PURPOSE, agreement: '이용허락범위 동의 항목에 체크',
    approval: ctx.spec.approval, autoApprove, traffic: ctx.spec.traffic, endpoint: ctx.spec.endpoint,
  });
  const needLogin = () => make('needs_login', '활용신청/키 확인에는 data.go.kr 로그인이 필요해요. 아직 아무것도 제출하지 않았거나, 제출 기록은 보존돼요.',
    'Not logged in: call apply_login, let the user log in, check apply_status, then re-run use_api.', 'apply_login');
  const needsSetup = (why) => make('needs_setup',
    `활용신청 자동화를 쓸 수 없어요${why ? ` (${why})` : ''}. npm install playwright-core && npx playwright-core install chromium 후 다시 실행하거나, 포털에서 직접 신청하고 save_key 로 키를 저장한 뒤 다시 실행하세요.`,
    'Browser automation unavailable: run doctor, or apply on the portal manually, save_key, then re-run use_api.', 'doctor');

  return {
    needLogin,
    invalid: () => make('invalid_input', '데이터 id(숫자) 또는 data.go.kr 데이터 URL 을 넣어주세요.', 'Pass a numeric data id or a data.go.kr data URL.', 'search_datasets'),
    unsupported: () => make('unsupported', `REST 요청주소를 읽지 못해 진행할 수 없어요(LINK/파일데이터이거나 포털 구조 변경). 확인: ${ctx.spec.pageUrl}`,
      'No REST endpoint in the spec; nothing was applied. Open pageUrl.', 'search_datasets', { pageUrl: ctx.spec.pageUrl }),
    blockedHost: (why) => make('blocked_host', `${why} 신청하지 않고 멈췄어요.`,
      'The endpoint host is not allowed to receive the service key; nothing was applied. Set DATAGO_ALLOWED_HOSTS if it is legitimate.'),
    async loginGate(apply, signal) {
      if (!apply.isAvailable()) return needsSetup();
      let state;
      try { state = await apply.checkLogin(); } catch (e) { return needsSetup(String(e.message).split('\n')[0]); }
      signal?.throwIfAborted();
      return state.loggedIn ? null : needLogin();
    },
    async dryRun({ name, applied, missing, apply, autoApprove }) {
      let loggedIn = null;
      if (apply.isAvailable()) { try { loggedIn = (await apply.checkLogin()).loggedIn; } catch { /* 알 수 없음 */ } }
      const would = [];
      if (name) would.push(`저장된 키 '${name}' 로 시험 호출 (성공하면 신청하지 않음)`);
      if (applied) would.push('활용신청은 이전에 제출한 기록이 있어 건너뜀');
      else would.push(`${name ? '키가 거부되면(20/30) ' : ''}활용신청 제출 — confirm:true 가 있어야 함`);
      would.push('필요하면 마이페이지에서 인증키 저장(기존 키는 덮어쓰지 않음)', '샘플 파라미터로 시험 호출', '별칭 저장 후 실행 예시 반환');
      return make('dry_run', `dryRun: 아무것도 바꾸지 않았고 API 도 호출하지 않았어요.\n- ${would.join('\n- ')}`,
        'Dry run: nothing submitted, saved or called.', again(applied ? '' : ', confirm: true'),
        { would, plan: plan(autoApprove), loggedIn, hasKey: Boolean(name), applied, missingParams: missing });
    },
    needConfirm: ({ name, first, autoApprove }) => make('needs_confirm',
      `${first ? `저장된 키 '${name}' 가 거부됐어요(resultCode ${first.r?.resultCode ?? first.r?.httpStatus}). 아직 이 API 를 신청하지 않았거나 승인 반영 전일 수 있어요(이미 신청돼 있으면 중복 제출되지 않고 확인만 해요). ` : '쓸 수 있는 키가 없어요. '}활용신청은 포털 계정을 바꾸므로 확인이 필요해요. 사용자에게 plan 을 보여주고 동의를 받은 뒤 confirm:true 로 다시 실행하세요.`,
      'Submitting an application changes the user\'s portal account: show plan, get consent, then re-run with confirm:true.',
      again(', confirm: true'), { plan: plan(autoApprove) }),
    applyFailed: (why) => make('apply_failed', `활용신청에 실패했어요: ${why || '원인 미확인'}`,
      'Application failed (LINK type, corporate-only, or portal change); apply manually on the portal page.', 'my_applications', { pageUrl: ctx.spec.pageUrl }),
    needKey: (why) => make('needs_key', `인증키를 저장하지 못했어요. ${why || ''} 마이페이지의 일반 인증키를 save_key 로 저장한 뒤 다시 실행하세요(신청은 다시 하지 않아요).`,
      'Key retrieval failed: user copies the general auth key, save_key, then re-run use_api.', 'save_key { name: "datago", key }'),
    needParams: (missing, name) => make('need_params', `샘플값이 없는 필수 변수가 있어 시험 호출하지 않았어요: ${missing.join(', ')}. params 로 값을 주고 다시 실행하세요.`,
      'Required params lack sample values; re-run with params.', again(`, params: { ${missing.map((m) => `${JSON.stringify(m)}: "..."`).join(', ')} }`),
      { missingParams: missing, keyName: name }),
    callFailed: (t, name) => make('call_failed',
      `시험 호출이 실패했어요${t.r?.resultCode != null ? ` (resultCode ${t.r.resultCode}: ${t.r.codeMeaning})` : ''}. ${t.r?.hint || t.error || ''}`.trim(),
      'Test call failed for a reason other than activation delay; check test.resultCode, adjust params, then re-run.', 'describe_api 로 요청 변수를 확인', { test: summaryOf(t), keyName: name }),
    pending({ test, alias, example, keyName, applied, retry }) {
      const code = test.r?.resultCode ?? `HTTP ${test.r?.httpStatus}`;
      const why = !applied ? '키가 아직 활성화되지 않았거나 이 API 용 신청이 없어요.'
        : retry.overdue ? '신청한 지 3시간이 넘었어요. 단순 반영 지연이 아닐 수 있으니 my_applications 로 승인 상태를 확인하세요. 신청 내역이 없으면 reapply:true, confirm:true 로 다시 신청할 수 있어요.'
          : '신청 직후에는 승인·반영에 보통 1~2시간이 걸려요(심의승인 API 는 더 걸릴 수 있음).';
      return make('pending_activation',
        `포털이 아직 키를 받아주지 않아요 (resultCode ${code}). ${why} 약 ${retry.retryInMinutes}분 뒤(${retry.retryAfter} 이후) 같은 명령을 다시 실행하세요.`,
        retry.overdue ? 'Still rejected after 3h: check my_applications and the key.' : 'Key not active yet (approval/propagation delay); retry after retryAfter.',
        retry.overdue ? 'my_applications' : again(), { test: summaryOf(test), alias, example, keyName, ...retry });
    },
    ready: ({ test, alias, example, keyName }) => make('ready',
      `준비 완료: 시험 호출 ${test.kind === 'nodata' ? '통과(키 정상, 샘플 조건에 데이터 없음)' : '성공'}. ${alias ? `별칭 '${alias}' 로 저장했어요. ` : ''}example 로 바로 호출하세요.`,
      'Ready: use example.call_api, or example.curl / example.js with DATAGO_SERVICE_KEY set.', 'call_api',
      { test: summaryOf(test), preview: test.items, alias, example, keyName }),
  };
}
