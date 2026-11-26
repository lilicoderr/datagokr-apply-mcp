// 활용신청 자동화 MCP 도구 (playwright-core 있을 때만 등록).

import * as apply from './apply.js';

function text(t) { return { content: [{ type: 'text', text: t }] }; }

export function registerApplyTools(server) {
  if (!apply.isAvailable()) {
    // 설치 안내만 하는 도구 하나
    server.tool('apply_setup', {
      description: '활용신청 자동화를 쓰려면 브라우저 자동화가 필요합니다. 설치 방법 안내.',
    }, async () => text(
      '활용신청 자동화는 playwright-core(시스템 Edge 구동)가 필요해요.\n'
      + '설치: 이 프로젝트 폴더에서 `npm install playwright-core`\n'
      + '설치 후 서버를 재시작하면 apply_login / apply_api 도구가 활성화됩니다.\n'
      + '※ 비밀번호는 저장하지 않습니다. 처음 한 번 브라우저에서 직접 로그인하면 세션만 보관돼요.'));
    return;
  }

  server.tool('apply_login', {
    description: '활용신청을 위해 data.go.kr 에 로그인한다. 브라우저 창이 뜨면 직접 로그인하세요. '
      + '비밀번호는 저장되지 않고 로그인 세션(쿠키)만 보관됩니다. 한 번만 하면 됩니다.',
    inputSchema: { type: 'object', properties: { timeoutSec: { type: 'number', description: '로그인 대기 시간(초, 기본 180)' } } },
  }, async (a) => {
    const r = await apply.interactiveLogin({ timeoutMs: (a.timeoutSec || 180) * 1000 });
    return text(`${r.ok ? '✅' : '⚠️'} ${r.message}\n세션 폴더: ${apply.profileDir()} (저장소 밖, 커밋되지 않음)`);
  });

  server.tool('apply_status', {
    description: 'data.go.kr 로그인 세션이 살아있는지 확인한다.',
  }, async () => {
    const r = await apply.checkLogin();
    return text(r.loggedIn ? '✅ 로그인 세션 유효' : '❌ 로그인 안 됨 — apply_login 을 먼저 실행하세요.');
  });

  server.tool('apply_api', {
    description: '특정 오픈API 에 활용신청(키 발급 요청)을 자동으로 넣는다. 로그인 세션 필요(apply_login). '
      + 'idOrUrl 에 데이터 id(숫자) 또는 openapi.do URL 을 준다.',
    inputSchema: {
      type: 'object',
      required: ['idOrUrl'],
      properties: {
        idOrUrl: { type: 'string', description: '데이터 id(예: 15012345) 또는 https://www.data.go.kr/data/15012345/openapi.do' },
        purpose: { type: 'string', description: '활용목적 (기본: "AI 개발 및 학습용")' },
        showBrowser: { type: 'boolean', description: 'true 면 브라우저 창을 보이며 진행(디버그용)' },
      },
    },
  }, async (a) => {
    const r = await apply.applyForApi({ idOrUrl: a.idOrUrl, purpose: a.purpose, headless: !a.showBrowser });
    const lines = [`${r.ok ? '✅' : 'ℹ️'} ${r.message}`];
    if (r.steps?.length) lines.push('진행: ' + r.steps.join(' → '));
    if (r.needLogin) lines.push('먼저 apply_login 을 실행하세요.');
    if (r.pageHint) lines.push(`페이지: ${r.pageHint}`);
    lines.push('신청 후 마이페이지(또는 my_applications)에서 인증키를 확인해 save_key 로 저장하면 call_api 에서 바로 써요.');
    return text(lines.join('\n'));
  });

  server.tool('my_applications', {
    description: '마이페이지 개발계정의 신청/발급 목록을 가져온다. 로그인 세션 필요.',
  }, async () => {
    const r = await apply.listMyApplications({});
    if (r.needLogin) return text('❌ 로그인 안 됨 — apply_login 먼저.');
    if (!r.items?.length) return text('목록을 찾지 못했어요. 포털 마이페이지에서 직접 확인하세요.');
    return text(`신청/발급 ${r.count}건:\n` + r.items.map((x, i) => `${i + 1}. ${x}`).join('\n'));
  });
}
