// 활용신청 자동화 MCP 도구 (playwright-core 있을 때만 등록).
//
// AI 사용 흐름:
//   1) apply_status 로 로그인 확인
//   2) 안 돼 있으면 apply_login (창이 열림 → 사용자가 로그인 → 바로 반환)
//      → 잠시 후 apply_status 로 로그인 완료 확인
//   3) apply_api 로 원하는 오픈API 활용신청 (여러 개면 반복 호출)
//   4) my_applications 로 신청/승인 확인, 발급된 키를 save_key 로 저장 → call_api 로 사용

import * as applyDefault from './apply.js';
import { annotateTools } from './annotations.js';

function text(t) { return { content: [{ type: 'text', text: t }] }; }

/**
 * @param {any} server
 * @param {import('./types.js').Options} [options]
 */
export function registerApplyTools(server, { apply: applyImpl } = {}) {
  const apply = applyImpl || applyDefault;
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
    description: '[활용신청 2단계] 특정 공공데이터 오픈API 에 개발계정 활용신청(키 발급)을 자동 제출한다. '
      + '로그인 세션이 있어야 한다(apply_status 로 확인). 개인회원 자동승인 API 는 즉시 승인된다. '
      + '여러 API 를 신청하려면 이 도구를 각 API 마다 호출하라. '
      + '예: apply_api({ idOrUrl: "15000314" }). LINK형(외부 바로가기) API나 기업회원 전용은 자동신청이 안 되며 그 경우 알려준다.',
    inputSchema: {
      type: 'object',
      required: ['idOrUrl'],
      properties: {
        idOrUrl: { type: 'string', description: '데이터 id(숫자, 예 "15000314") 또는 data.go.kr 데이터 URL' },
        purpose: { type: 'string', description: '활용목적 설명(필수 입력란 채움). 기본 "개인 학습 및 서비스 개발용"' },
        showBrowser: { type: 'boolean', description: '과정을 창으로 보며 진행(디버그용). 기본 false(헤드리스)' },
      },
    },
  }, async (a) => {
    const r = await apply.applyForApi({ idOrUrl: a.idOrUrl, purpose: a.purpose, headless: !a.showBrowser });
    const lines = [];
    if (r.ok) lines.push(`✅ 활용신청 완료: ${a.idOrUrl}`);
    else if (r.already) lines.push(`↺ 이미 신청된 API: ${a.idOrUrl}`);
    else if (r.needLogin) lines.push('❌ 로그인 필요 — apply_login 먼저.');
    else lines.push(`⚠️ 신청 실패: ${r.message}`);
    if (r.ok) lines.push('자동승인 API 면 1~2시간 뒤 호출 가능. my_applications 에서 발급 키 확인 → save_key 로 저장하면 call_api 로 사용.');
    if (r.dialog) lines.push(`(서버 응답: ${r.dialog})`);
    return text(lines.join('\n'));
  });

  server.tool('apply_apis', {
    description: '[활용신청 일괄] 여러 오픈API 에 한 번에 활용신청한다. ids 에 데이터 id/URL 배열을 준다. '
      + '많은 API 를 신청할 때 apply_api 를 반복하는 대신 이걸 쓰면 편하다. 로그인 세션 필요.',
    inputSchema: {
      type: 'object',
      required: ['ids'],
      properties: {
        ids: { type: 'array', items: { type: 'string' }, description: '데이터 id 또는 URL 목록 (예: ["15000314","15057552"])' },
        purpose: { type: 'string', description: '활용목적(공통). 기본 "개인 학습 및 서비스 개발용"' },
      },
    },
  }, async (a, ctx) => {
    const r = await apply.applyForApis(a.ids || [], {
      purpose: a.purpose,
      signal: ctx?.signal,
      onProgress: (i, total, id) => ctx?.progress?.(i, total, `활용신청 ${i}/${total}: ${id}`),
    });
    const lines = [`요청 ${r.total}건 → ✅완료 ${r.done} · ↺이미 ${r.already} · ⚠️실패 ${r.failed}`];
    for (const x of r.results) {
      lines.push(`  ${x.ok ? '✅' : x.already ? '↺' : '⚠️'} ${x.idOrUrl}${x.error ? ` (${x.error})` : ''}`);
    }
    if (r.needLogin) lines.push(`❌ 로그인 세션이 없어 중단했어요(남은 ${r.skipped}건 미시도). apply_login 후 다시 시도하세요.`);
    if (r.invalid.length) lines.push(`⚠️ 인식 못 한 입력 ${r.invalid.length}건(무시): ${r.invalid.join(', ')}`);
    if (r.duplicates.length) lines.push(`↺ 중복 ${r.duplicates.length}건 제외: ${r.duplicates.join(', ')}`);
    if (r.truncated) lines.push(`※ 한 번에 최대 50건까지만 처리해요. ${r.truncated}건은 다시 요청하세요.`);
    if (r.done) lines.push('발급 키는 my_applications 에서 확인 → save_key 로 저장하면 call_api 로 사용.');
    return text(lines.join('\n'));
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
      ? '\n→ 승인된 API 의 인증키는 포털 마이페이지 > 개발계정에서 확인해 save_key 로 저장하세요.' : '';
    return text(`${head}${counts ? ` (${counts})` : ''}\n` + r.parsed.map((x, i) => `${i + 1}. [${x.status}] ${x.name}`).join('\n') + hint);
  });
  annotateTools(server);
}
