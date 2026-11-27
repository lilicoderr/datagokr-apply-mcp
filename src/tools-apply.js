// 활용신청 자동화 MCP 도구 (playwright-core 있을 때만 등록).
//
// AI 사용 흐름 (검색 → 명세 → 신청 → 키 → 호출):
//   1) apply_status 로 로그인 확인
//   2) 안 돼 있으면 apply_login (창이 열림 → 사용자가 로그인 → 바로 반환) → apply_status 로 재확인
//   3) find_apply_targets / describe_api 로 대상 확인 → apply_api (단일 idOrUrl 또는 ids 배열)
//   4) 신청 성공 시 인증키를 마이페이지에서 자동으로 읽어 레지스트리에 저장(마스킹 출력) — 실패 시 apply_get_key
//   5) call_api 로 호출

import * as applyDefault from './apply.js';
import { annotateTools } from './annotations.js';
import { maskSecret } from './keyextract.js';

function text(t) { return { content: [{ type: 'text', text: t }] }; }
function fail(message) {
  return { content: [{ type: 'text', text: message }], structuredContent: { ok: false, message }, isError: true };
}

/**
 * @param {any} server
 * @param {import('./types.js').Options} [options]
 */
export function registerApplyTools(server, { apply: applyImpl, registry } = {}) {
  const apply = applyImpl || applyDefault;

  // 인증키를 읽어 저장한다. 원문은 반환·로그하지 않고 마스킹 값만 돌려준다.
  async function retrieveKey({ headless = true, keyName = undefined } = {}) {
    const name = keyName || 'datago';
    try {
      const r = await apply.fetchServiceKey({ headless });
      if (!r.ok) return { ok: false, saved: false, needLogin: Boolean(r.needLogin), message: r.message };
      const raw = r.keys.encoding || r.keys.decoding;
      if (!registry) {
        return { ok: true, saved: false, masked: maskSecret(raw), message: `인증키를 읽었지만 저장소가 없어 저장하지 못했어요 (${maskSecret(raw)}).` };
      }
      registry.saveKey(name, raw, '활용신청 자동 발급(마이페이지 일반 인증키)');
      return { ok: true, saved: true, keyName: name, masked: maskSecret(raw),
        message: `인증키를 읽어 '${name}' 이름으로 저장했어요 (${maskSecret(raw)}). 이제 call_api 로 호출할 수 있어요.` };
    } catch (e) {
      return { ok: false, saved: false, message: `인증키 읽기 실패: ${String(e?.message || e).split(String.fromCharCode(10))[0]}` };
    }
  }

  if (!apply.isAvailable()) {
    server.tool('apply_setup', {
      description: '공공데이터 활용신청 자동화를 켜는 방법. (브라우저 자동화 미설치 상태) '
        + '이 서버에서 apply_* 도구가 안 보이면 이 안내를 사용자에게 전달하세요.',
    }, async () => text(
      '활용신청 자동화를 쓰려면 이 프로젝트 폴더에서 한 번 설치하세요:\n'
      + '  npm install playwright-core\n'
      + '  npx playwright-core install chromium\n'
      + '설치 후 MCP 서버를 재시작하면 apply_login / apply_api 가 활성화됩니다.\n'
      + '※ 비밀번호는 저장하지 않고, 로그인 세션만 홈 폴더(저장소 밖)에 보관합니다.'));
    annotateTools(server);
    return;
  }

  server.tool('apply_login', {
    description: '[활용신청 1단계] data.go.kr 로그인 창을 연다. 호출하면 브라우저 창이 뜨고 바로 반환된다'
      + '(로그인 완료를 기다리지 않음). 사용자가 그 창에서 직접 로그인하면 세션이 자동 저장된다. '
      + '비밀번호는 저장되지 않는다. 호출 뒤 사용자에게 "창에서 로그인해 달라"고 안내하고, '
      + '잠시 뒤 apply_status 로 로그인 완료를 확인하라. 로그인은 보통 한 번만 하면 된다.',
    inputSchema: { type: 'object', properties: { timeoutMin: { type: 'number', description: '창을 열어둘 시간(분, 기본 20)' } } },
  }, async (a) => {
    const r = await apply.startLogin({ timeoutMin: a.timeoutMin || 20 });
    return text(`🪟 ${r.message}`);
  });

  server.tool('apply_status', {
    description: '[활용신청 확인] data.go.kr 로그인 세션이 유효한지 확인한다. apply_api 전에 먼저 호출해 '
      + '로그인 여부를 확인하라. 로그인이 확인되면 열려 있던 로그인 창은 자동으로 닫힌다.',
  }, async () => {
    const r = await apply.checkLogin();
    return text(r.loggedIn
      ? '✅ 로그인됨 — 이제 apply_api 로 활용신청할 수 있어요.'
      : '❌ 로그인 안 됨 — apply_login 을 호출해 창을 띄우고, 사용자가 로그인한 뒤 다시 확인하세요.');
  });

  server.tool('apply_api', {
    description: '[활용신청 2~3단계] 오픈API 에 개발계정 활용신청(키 발급)을 자동 제출하고, 성공하면 마이페이지 > 개발계정의 '
      + '일반 인증키를 자동으로 읽어 레지스트리에 저장한다(원문은 출력하지 않고 마스킹). 이후 바로 call_api 로 호출한다. '
      + '단일은 idOrUrl, 여러 개는 ids 배열(한 번에 최대 50건)로 호출한다 — 한 번의 호출로 끝낸다. '
      + '로그인 세션 필요(apply_status). 개인회원 자동승인 API 는 즉시 승인된다. '
      + '예: apply_api({ idOrUrl: "15000314" }) 또는 apply_api({ ids: ["15000314","15057552"] }). '
      + 'LINK형 API 나 기업회원 전용은 자동신청이 안 되며 그 경우 알려준다.',
    inputSchema: {
      type: 'object',
      properties: {
        idOrUrl: { type: 'string', description: '데이터 id(숫자, 예 "15000314") 또는 data.go.kr 데이터 URL' },
        ids: { type: 'array', items: { type: 'string' }, description: '여러 API 를 한 번에 신청할 때 id/URL 목록' },
        purpose: { type: 'string', description: '활용목적(필수 입력란). 기본 "개인 학습 및 서비스 개발용"' },
        keyName: { type: 'string', description: '자동 저장할 키 이름 (기본 "datago")' },
        autoKey: { type: 'boolean', description: '신청 성공 뒤 인증키 자동 저장 (기본 true)' },
        showBrowser: { type: 'boolean', description: '과정을 창으로 보며 진행(디버그용). 기본 false(헤드리스)' },
      },
    },
  }, async (a, ctx) => {
    const list = Array.isArray(a.ids) && a.ids.length ? a.ids : (a.idOrUrl ? [a.idOrUrl] : []);
    if (!list.length) return fail('idOrUrl 또는 ids 가 필요합니다.');
    const headless = !a.showBrowser;
    const r = await apply.applyForApis(list, {
      purpose: a.purpose, headless, signal: ctx?.signal,
      onProgress: (i, total, id) => ctx?.progress?.(i, total, `활용신청 ${i}/${total}: ${id}`),
    });
    const results = r.results.map((x) => ({
      idOrUrl: x.idOrUrl, ok: Boolean(x.ok), already: Boolean(x.already),
      message: x.message || x.error || '',
    }));
    const lines = [`요청 ${r.total}건 → 완료 ${r.done} · 이미 신청 ${r.already} · 실패 ${r.failed}`];
    for (const x of results) lines.push(`  ${x.ok ? 'OK' : x.already ? '이미' : '실패'} ${x.idOrUrl} ${x.ok ? '' : x.message}`);
    if (r.needLogin) lines.push(`로그인 세션이 없어 중단했어요(남은 ${r.skipped}건 미시도). apply_login 후 다시 시도하세요.`);
    if (r.invalid.length) lines.push(`인식 못 한 입력 ${r.invalid.length}건(무시): ${r.invalid.join(', ')}`);
    if (r.duplicates.length) lines.push(`중복 ${r.duplicates.length}건 제외: ${r.duplicates.join(', ')}`);
    if (r.truncated) lines.push(`한 번에 최대 50건까지만 처리해요. ${r.truncated}건은 다시 요청하세요.`);
    let key = null;
    if ((r.done || r.already) && a.autoKey !== false) {
      key = await retrieveKey({ headless, keyName: a.keyName });
      lines.push(key.message);
    } else if (r.done) lines.push('apply_get_key 로 인증키를 가져와 저장하세요.');
    if (r.done) lines.push('자동승인 API 는 1~2시간 뒤 호출 가능할 수 있어요. 키가 저장됐으면 call_api 로 호출하세요.');
    const out = {
      ok: r.done > 0 || r.already > 0, total: r.total, done: r.done, already: r.already, failed: r.failed,
      needLogin: r.needLogin, results, key,
      message: lines.join('\n'),
    };
    return { content: [{ type: 'text', text: out.message }], structuredContent: out };
  });

  server.tool('apply_get_key', {
    description: '[활용신청 3단계] 로그인 세션으로 마이페이지 > 개발계정의 일반 인증키(Encoding/Decoding)를 읽어 '
      + '레지스트리에 저장한다(save_key 와 동일). 키 원문은 출력하지 않고 마스킹해 보여준다. '
      + 'apply_api 가 자동으로 호출하지만, 실패했거나 나중에 다시 받을 때 직접 쓴다.',
    inputSchema: { type: 'object', properties: {
      keyName: { type: 'string', description: '저장할 키 이름 (기본 "datago")' },
      showBrowser: { type: 'boolean' },
    } },
  }, async (a) => {
    const key = await retrieveKey({ headless: !a.showBrowser, keyName: a.keyName });
    return { content: [{ type: 'text', text: key.message }], structuredContent: key };
  });

  server.tool('my_applications', {
    description: '[활용신청 확인] 마이페이지의 활용신청/발급 현황을 가져온다(승인 여부 포함). '
      + 'apply_api 후 결과 확인이나, 어떤 API 를 이미 신청했는지 볼 때 사용. 로그인 세션 필요.',
  }, async () => {
    const r = await apply.listMyApplications({});
    if (r.needLogin) return text('❌ 로그인 안 됨 — apply_login 먼저.');
    const head = r.total != null ? `활용신청 현황 ${r.total}건` : `목록 ${r.count}건`;
    if (!r.items?.length) return text(`${head}\n(목록 항목을 파싱하지 못했어요. 포털 마이페이지에서 확인하세요.)`);
    const counts = Object.entries(r.byStatus || {}).map(([k, v]) => `${k} ${v}`).join(' · ');
    const hint = r.byStatus?.['승인']
      ? '\n→ 인증키가 아직 저장되지 않았다면 apply_get_key 를 호출하세요.' : '';
    return text(`${head}${counts ? ` (${counts})` : ''}\n` + r.parsed.map((x, i) => `${i + 1}. [${x.status}] ${x.name}`).join('\n') + hint);
  });
  annotateTools(server);
}
