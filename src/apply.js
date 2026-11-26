// 활용신청 자동화 (브라우저 자동화, Playwright 번들 Chromium)
//
//   보안 원칙:
//    · 비밀번호를 받지도, 저장하지도, 로그에 남기지도 않는다.
//    · 로그인은 "한 번만" 사람이 직접(headful 창). 로그인 뒤 세션(쿠키)을 storageState 파일로
//      홈 폴더에 저장하고, 이후 신청은 그 세션을 재사용한다.
//    · storageState 파일은 저장소 밖 + .gitignore 라 절대 커밋되지 않는다.
//
//   data.go.kr 세션은 세션 쿠키라서 브라우저를 닫으면 사라진다 → persistent profile 대신
//   storageState(쿠키 스냅샷)로 저장해야 재사용된다.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME_DIR = process.env.DATAGO_HOME || path.join(os.homedir(), '.datagokr-mcp');
const STATE_FILE = process.env.DATAGO_STATE || path.join(HOME_DIR, 'storage-state.json');
const BASE = 'https://www.data.go.kr';
const MYPAGE = `${BASE}/iim/main/mypageMain.do`;
// 헤드리스 티를 줄이기 위한 일반 Chrome UA (HeadlessChrome 노출 방지).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let chromium = null;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  chromium = null;
}

export function isAvailable() {
  return chromium !== null;
}
export function stateFile() {
  return STATE_FILE;
}
export function hasSession() {
  return fs.existsSync(STATE_FILE);
}

function contextOptions(withState = true) {
  const opts = { locale: 'ko-KR', userAgent: UA, viewport: { width: 1280, height: 900 } };
  if (withState && fs.existsSync(STATE_FILE)) opts.storageState = STATE_FILE;
  return opts;
}

// 브라우저를 열어 fn(context) 을 실행하고 반드시 닫는다.
async function withContext({ headless = true, withState = true } = {}, fn) {
  if (!chromium) throw new Error('playwright-core 가 설치돼 있지 않습니다. `npm install playwright-core` 후 사용하세요.');
  const browser = await chromium.launch({ headless, args: ['--no-first-run', '--no-default-browser-check'] });
  try {
    const context = await browser.newContext(contextOptions(withState));
    return await fn(context);
  } finally {
    await browser.close();
  }
}

// 마이페이지로 이동해 로그인 페이지로 튕기지 않으면 로그인 상태로 본다.
async function isAuthed(page) {
  try {
    await page.goto(MYPAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(500);
    return !/auth\.data\.go\.kr|common-login|\/login/i.test(page.url());
  } catch {
    return false;
  }
}

export async function checkLogin() {
  const result = await withContext({ headless: true }, async (ctx) => {
    const page = await ctx.newPage();
    const loggedIn = await isAuthed(page);
    return { loggedIn };
  });
  // 로그인 확인되면 열려 있던 로그인 창을 닫는다.
  if (result.loggedIn && loginWindow) await closeLoginWindow();
  return result;
}

// 열려 있는 로그인 창(논블로킹). 서버가 살아 있는 동안 유지된다.
let loginWindow = null;

export function isLoginWindowOpen() {
  return loginWindow !== null;
}

// 로그인 창을 "열기만" 하고 즉시 반환(논블로킹). 사용자가 로그인하면 세션이 몇 초마다 자동 저장된다.
// 로그인 완료는 checkLogin() 으로 확인하며, 확인되면 창은 자동으로 닫힌다.
export async function startLogin({ timeoutMin = 20 } = {}) {
  if (!chromium) throw new Error('playwright-core 가 필요합니다. `npm install playwright-core` 후 사용하세요.');
  if (loginWindow) return { started: true, already: true, message: '로그인 창이 이미 열려 있어요. 그 창에서 로그인하세요.' };
  fs.mkdirSync(HOME_DIR, { recursive: true });
  const profile = path.join(HOME_DIR, 'login-profile');
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: ['--no-first-run', '--no-default-browser-check'],
    viewport: { width: 1280, height: 900 },
    locale: 'ko-KR',
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  try { await page.getByRole('link', { name: /로그인/ }).first().click({ timeout: 4000 }); } catch { /* 직접 진행 */ }

  // 세션 쿠키는 세션 스코프라, 열려 있는 동안 주기적으로 스냅샷해 둬야 재사용된다.
  const timer = setInterval(() => { ctx.storageState({ path: STATE_FILE }).catch(() => {}); }, 4000);
  timer.unref?.();
  const closeTimer = setTimeout(() => { closeLoginWindow().catch(() => {}); }, timeoutMin * 60000);
  closeTimer.unref?.();
  loginWindow = { ctx, timer, closeTimer };
  return {
    started: true,
    message: `로그인 창을 열었어요. 그 창에서 data.go.kr 에 로그인하세요(비번은 저장되지 않아요). 로그인하면 자동 저장되며, apply_status 로 확인하면 창이 닫혀요. (최대 ${timeoutMin}분)`,
  };
}

async function closeLoginWindow() {
  if (!loginWindow) return;
  const w = loginWindow;
  loginWindow = null;
  clearInterval(w.timer);
  clearTimeout(w.closeTimer);
  try { await w.ctx.storageState({ path: STATE_FILE }); } catch { /* 무시 */ }
  try { await w.ctx.close(); } catch { /* 무시 */ }
}

// 호환용: 기존 이름. 이제는 창만 열고 반환한다.
export async function interactiveLogin(opts = {}) {
  return startLogin(opts);
}

export function extractDataPk(idOrUrl) {
  const v = String(idOrUrl || '').trim();
  if (/^\d+$/.test(v)) return v;
  const m = v.match(/\/data\/(\d+)\//) || v.match(/publicDataPk=(\d+)/);
  return m ? m[1] : null;
}

// 개인회원 기준 개발계정 활용신청 자동 제출. (자동승인 API 는 바로 발급)
// 검증된 플로우: 신청 폼으로 바로 이동 → 활용목적 입력 → 이용허락 동의 → 제출 → 완료 다이얼로그 확인.
export async function applyForApi({ idOrUrl, purpose = '개인 학습 및 서비스 개발용', headless = true } = {}) {
  const pk = extractDataPk(idOrUrl);
  if (!pk) throw new Error('데이터 id(숫자) 또는 data.go.kr URL 을 넣어주세요.');

  return withContext({ headless }, async (ctx) => {
    const steps = [];
    const dialogs = [];
    const page = await ctx.newPage();
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept().catch(() => {}); });

    // 개발계정 신청 폼으로 바로 이동 (활용신청 버튼의 window.open 대상과 동일)
    const formUrl = `${BASE}/tcs/dss/redirectDevAcountRequestForm.do?publicDataPk=${pk}&isBusinessApply=undefined`;
    await page.goto(formUrl, { waitUntil: 'networkidle', timeout: 40000 }).catch(() => {});
    if (/login|loginView/i.test(page.url())) {
      return { ok: false, needLogin: true, message: '로그인 세션이 없습니다. 먼저 apply_login.', steps };
    }
    if (!page.url().includes('AcountRequestForm') && !(await page.locator('textarea[name="prcusePurps"]').count())) {
      return { ok: false, message: '신청 폼을 열지 못했습니다. (LINK형 API이거나 기업회원 전용일 수 있어요)', steps, pageHint: page.url() };
    }
    steps.push('신청 폼 열기');

    // 활용목적 설명(필수)
    await page.fill('textarea[name="prcusePurps"]', purpose, { timeout: 8000 }).catch(() => {});
    steps.push('활용목적 입력');

    // 이용허락범위 동의 (숨은 input → 라벨 클릭). 상세기능은 기본 전체선택.
    const agree = page.locator('label:has-text("동의합니다")');
    const an = await agree.count();
    for (let i = 0; i < an; i++) await agree.nth(i).click({ timeout: 2000 }).catch(() => {});
    steps.push('이용허락 동의');

    // 제출 (확인 다이얼로그 → accept, 완료 다이얼로그 수신)
    await page.getByRole('button', { name: /활용\s*신청하기/ }).first().click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(3500);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    steps.push('제출');

    const msg = dialogs.join(' | ');
    const done = /신청이?\s*완료|완료되었|정상적으로\s*신청/.test(msg);
    const already = /이미.*신청|신청.*내역이\s*있/.test(msg);
    return {
      ok: done,
      already,
      message: done
        ? `활용신청 완료 (자동승인 API 는 1~2시간 후 호출 가능). ${already ? '※ 이미 신청된 API' : ''}`
        : (already ? '이미 신청된 API 입니다.' : '완료 문구를 확인하지 못했습니다. showBrowser:true 로 확인하세요.'),
      dialog: msg.slice(0, 160),
      steps,
      landedUrl: page.url(),
    };
  });
}

export async function listMyApplications({ headless = true } = {}) {
  return withContext({ headless }, async (ctx) => {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/iim/api/selectAcountList.do`, { waitUntil: 'networkidle', timeout: 40000 }).catch(() => {});
    if (/login|loginView/i.test(page.url())) {
      return { ok: false, needLogin: true, message: '로그인 세션이 없습니다. 먼저 apply_login.' };
    }
    const data = await page.evaluate(() => {
      const body = document.body.innerText;
      const m = body.match(/활용신청\s*현황\s*(\d+)/);
      const total = m ? Number(m[1]) : null;
      // [승인]/[신청]/[반려] 로 시작하거나 데이터명 패턴인 항목
      const names = [...document.querySelectorAll('a, td, .title, .tit, strong')]
        .map((e) => e.innerText.trim())
        .filter((t) => /^\[(승인|신청|반려|중지)\]/.test(t) || (/_|서비스|조회|정보/.test(t) && t.length > 6 && t.length < 60));
      return { total, items: [...new Set(names)].slice(0, 30) };
    });
    return { ok: true, total: data.total, count: data.items.length, items: data.items };
  });
}

export function toOpenApiUrl(idOrUrl) {
  const v = String(idOrUrl || '').trim();
  if (/^\d+$/.test(v)) return `${BASE}/data/${v}/openapi.do`;
  if (/^https?:\/\/.*data\.go\.kr/.test(v)) return v;
  const m = v.match(/\/data\/(\d+)\//);
  if (m) return `${BASE}/data/${m[1]}/openapi.do`;
  return null;
}
