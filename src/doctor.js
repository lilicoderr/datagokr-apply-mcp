// 환경 점검(doctor) — "왜 안 되지?" 를 한 번에 진단한다.
//
//   runDoctor(deps) → [{ id, status: 'ok'|'warn'|'fail', title, detail, fix? }]
//   모든 외부 의존(파일/네트워크/브라우저)은 deps 로 주입해 테스트에서 바꿔 끼운다.

import fs from 'node:fs';

const MIN_NODE_MAJOR = 20;

export function nodeMajor(version = process.versions.node) {
  return Number(String(version).split('.')[0]);
}

export async function runDoctor({
  registry,
  usage,
  apply,
  fetchImpl = (...a) => globalThis.fetch(...a),
  nodeVersion = process.versions.node,
  platform = process.platform,
  netUrl = 'https://apis.data.go.kr',
  timeoutMs = 6000,
} = {}) {
  const out = [];
  const add = (id, status, title, detail, fix) => out.push({ id, status, title, detail, ...(fix ? { fix } : {}) });

  // 1) Node 버전
  const major = nodeMajor(nodeVersion);
  if (major >= MIN_NODE_MAJOR) add('node', 'ok', 'Node.js', `v${nodeVersion}`);
  else add('node', 'fail', 'Node.js', `v${nodeVersion} (필요: ${MIN_NODE_MAJOR}+)`, 'Node 20 이상으로 업데이트하세요: https://nodejs.org');

  // 2) 설정 파일 / 키
  if (registry) {
    const exists = fs.existsSync(registry.file);
    const { keys, defaultKey } = registry.listKeys();
    const names = Object.keys(keys);
    if (!exists) {
      add('config', 'warn', '설정 파일', `${registry.file} 없음 (첫 사용)`, 'save_key 도구로 키를 저장하면 자동 생성돼요. 키가 없으면 apply_api 로 발급받으세요.');
    } else if (!names.length) {
      add('keys', 'warn', '서비스 키', '저장된 키 없음', 'save_key 로 키를 저장하세요. (apply_guide 참고)');
    } else {
      add('keys', defaultKey ? 'ok' : 'warn', '서비스 키', `${names.length}개 저장 (기본: ${defaultKey ?? '없음'}) — ${names.map((n) => `${n}[${keys[n].encoded ? 'Encoding' : 'Decoding'}]`).join(', ')}`,
        defaultKey ? undefined : 'set_default_key 로 기본 키를 지정하세요.');
    }
    // 권한(POSIX 만) — 키 파일을 다른 사용자가 읽을 수 있으면 경고
    if (exists && platform !== 'win32') {
      const mode = fs.statSync(registry.file).mode & 0o777;
      if (mode & 0o077) add('perm', 'warn', '설정 파일 권한', `${mode.toString(8)} — 다른 사용자도 읽을 수 있어요`, `chmod 600 ${registry.file}`);
      else add('perm', 'ok', '설정 파일 권한', mode.toString(8));
    }
  }

  // 3) 네트워크
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(netUrl, { method: 'GET', signal: ctrl.signal });
      add('network', 'ok', '공공데이터 서버 연결', `${netUrl} → HTTP ${res.status}`);
    } finally { clearTimeout(timer); }
  } catch (e) {
    add('network', 'fail', '공공데이터 서버 연결', `${netUrl} 접속 실패: ${e?.cause?.code || e?.name || e?.message}`, '인터넷/프록시/방화벽을 확인하세요.');
  }

  // 4) 활용신청 자동화 (선택 기능)
  if (apply) {
    if (!apply.isAvailable()) {
      add('playwright', 'warn', '활용신청 자동화(playwright-core)', '미설치 — API 호출·키 관리는 정상, apply_* 도구만 꺼져 있어요',
        'npm install playwright-core && npx playwright-core install chromium');
    } else {
      add('playwright', 'ok', 'playwright-core', '설치됨');
      if (apply.browserInstalled()) add('chromium', 'ok', '번들 Chromium', '설치됨');
      else add('chromium', 'fail', '번들 Chromium', 'playwright-core 는 있으나 브라우저 미설치', 'npx playwright-core install chromium');
      if (apply.hasSession()) add('session', 'ok', '로그인 세션 파일', `${apply.stateFile()} (유효 여부는 apply_status 로 확인)`);
      else add('session', 'warn', '로그인 세션 파일', '없음 — 아직 로그인 안 함', 'apply_login 으로 창을 열고 직접 로그인하세요.');
    }
  }

  // 5) 오늘 호출량
  if (usage) {
    const s = usage.summary();
    const hot = Object.entries(s.byKey).filter(([, v]) => v.warn).map(([k]) => k);
    add('usage', hot.length ? 'warn' : 'ok', '오늘 호출량(추정)', `${s.total}회 / 한도 ${s.limit}회${hot.length ? ` — 80% 이상: ${hot.join(', ')}` : ''}`,
      hot.length ? '한도(resultCode 22)에 근접했어요. 대량 호출을 미루거나 트래픽 증설을 신청하세요.' : undefined);
  }
  return out;
}

const ICON = { ok: '✅', warn: '⚠️ ', fail: '❌' };

export function formatReport(results) {
  const lines = results.map((r) => `${ICON[r.status]} ${r.title}: ${r.detail}${r.fix ? `\n     → ${r.fix}` : ''}`);
  const fails = results.filter((r) => r.status === 'fail').length;
  const warns = results.filter((r) => r.status === 'warn').length;
  lines.push('', fails ? `문제 ${fails}건 · 주의 ${warns}건 — 위 "→" 안내대로 고치면 돼요.`
    : warns ? `치명적 문제 없음 (주의 ${warns}건).` : '모두 정상이에요. 🎉');
  return lines.join('\n');
}

export function exitCode(results) {
  return results.some((r) => r.status === 'fail') ? 1 : 0;
}

// doctor --fix: 안전하게 자동 수정할 수 있는 항목만 고친다 (키·세션은 건드리지 않는다).
//   fixable: config(설정 파일 생성), perm(chmod 600), chromium(브라우저 설치)
export async function applyFixes(results, { registry, runCommand, platform = process.platform } = {}) {
  const actions = [];
  const done = (id, ok, msg) => actions.push({ id, ok, msg });
  for (const r of results) {
    if (r.status === 'ok') continue;
    try {
      if (r.id === 'config' && registry) {
        done('config', true, registry.init() ? `설정 파일 생성: ${registry.file}` : '이미 있음');
      } else if (r.id === 'perm' && registry && platform !== 'win32') {
        fs.chmodSync(registry.file, 0o600);
        done('perm', true, `chmod 600 ${registry.file}`);
      } else if (r.id === 'chromium' && runCommand) {
        const code = await runCommand('npx', ['playwright-core', 'install', 'chromium']);
        done('chromium', code === 0, code === 0 ? 'Chromium 설치 완료' : `설치 실패(exit ${code}) — 수동: npx playwright-core install chromium`);
      }
    } catch (e) {
      done(r.id, false, e.message);
    }
  }
  return actions;
}

export function formatFixes(actions) {
  if (!actions.length) return '자동으로 고칠 수 있는 항목이 없어요. (키 저장·로그인은 직접 해야 해요)';
  return actions.map((a) => `${a.ok ? '🔧' : '❌'} ${a.id}: ${a.msg}`).join('\n');
}
