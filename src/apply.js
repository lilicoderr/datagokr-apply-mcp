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
  return withContext({ headless: true }, async (ctx) => {
    const page = await ctx.newPage();
    const loggedIn = await isAuthed(page);
    return { loggedIn };
  });
}

// 사람이 직접 로그인(headful). 로그인되면 세션을 STATE_FILE 로 저장하고 종료.
export async function interactiveLogin({ timeoutMs = 300000 } = {}) {
  if (!chromium) throw new Error('playwright-core 가 필요합니다.');
  fs.mkdirSync(HOME_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: false, args: ['--no-first-run', '--no-default-browser-check'] });
  try {
    const context = await browser.newContext(contextOptions(true));
    const page = await context.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    try {
      await page.getByRole('link', { name: /로그인/ }).first().click({ timeout: 5000 });
    } catch { /* 사용자가 직접 로그인 진행 */ }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // 로그인 완료 판정: 메인/마이페이지 어디서든 auth 로 튕기지 않으면 성공
      const url = page.url();
      if (!/auth\.data\.go\.kr|common-login/i.test(url)) {
        const probe = await context.newPage();
        const ok = await isAuthed(probe);
        await probe.close();
        if (ok) {
          await context.storageState({ path: STATE_FILE });
          return { ok: true, message: '로그인 성공. 세션을 저장했습니다.' };
        }
      }
      await page.waitForTimeout(2000);
    }
    return { ok: false, message: '시간 초과: 로그인 창에서 직접 로그인한 뒤 다시 시도하세요.' };
  } finally {
    await browser.close();
  }
}

export async function applyForApi({ idOrUrl, purpose = 'AI 개발 및 학습용', headless = true } = {}) {
  const url = toOpenApiUrl(idOrUrl);
  if (!url) throw new Error('데이터 id(숫자) 또는 openapi.do URL 을 넣어주세요.');

  return withContext({ headless }, async (ctx) => {
    const steps = [];
    const page = await ctx.newPage();
    if (!(await isAuthed(page))) {
      return { ok: false, needLogin: true, message: '로그인 세션이 없습니다. 먼저 apply_login 으로 로그인하세요.', steps };
    }
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    steps.push(`페이지 열기: ${url}`);

    const applyBtn = page.getByRole('link', { name: /활용신청/ }).first()
      .or(page.getByRole('button', { name: /활용신청/ }).first());
    await applyBtn.click({ timeout: 15000 });
    steps.push('활용신청 클릭');
    await page.waitForLoadState('domcontentloaded');

    const purposeBox = page.locator('textarea').first();
    if (await purposeBox.count()) {
      await purposeBox.fill(purpose, { timeout: 8000 }).catch(() => {});
      steps.push('활용목적 입력');
    }

    const boxes = page.locator('input[type="checkbox"]');
    const n = await boxes.count();
    for (let i = 0; i < n; i++) {
      const b = boxes.nth(i);
      if (await b.isVisible().catch(() => false) && !(await b.isChecked().catch(() => false))) {
        await b.check({ timeout: 3000 }).catch(() => {});
      }
    }
    if (n) steps.push(`동의 체크 ${n}개`);

    const submit = page.getByRole('button', { name: /^신청$|신청하기|활용신청 신청/ }).first()
      .or(page.getByRole('link', { name: /^신청$|신청하기/ }).first());
    await submit.click({ timeout: 10000 });
    steps.push('신청 제출');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    const bodyText = await page.locator('body').innerText().catch(() => '');
    const ok = /신청이?\s*(완료|접수)|승인|정상적으로|신청되었습니다/.test(bodyText);
    return {
      ok,
      message: ok
        ? '활용신청을 제출했습니다. (자동승인 API 면 바로, 아니면 심사 후 발급)'
        : '신청 버튼까지 진행했으나 완료 문구를 확인하지 못했습니다. showBrowser:true 로 과정을 확인하거나 포털에서 결과를 보세요.',
      steps,
      pageHint: bodyText.replace(/\s+/g, ' ').slice(0, 300),
    };
  });
}

export async function listMyApplications({ headless = true } = {}) {
  return withContext({ headless }, async (ctx) => {
    const page = await ctx.newPage();
    if (!(await isAuthed(page))) {
      return { ok: false, needLogin: true, message: '로그인 세션이 없습니다. 먼저 apply_login.' };
    }
    await page.goto(`${BASE}/iim/api/selectAcountList.do`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    const rows = await page.locator('table tbody tr').allInnerTexts().catch(() => []);
    const items = rows.map((r) => r.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 50);
    return { ok: true, count: items.length, items };
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
