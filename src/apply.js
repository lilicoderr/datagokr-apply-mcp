// 활용신청 자동화 (브라우저 자동화, 시스템 Edge 구동)
//
//   보안 원칙:
//    · 비밀번호를 받지도, 저장하지도, 로그에 남기지도 않는다.
//    · 로그인은 "한 번만" 사람이 직접(headful 창). 세션 쿠키만 홈 폴더 프로필에 저장되고
//      그 폴더는 저장소 밖 + .gitignore 라 절대 커밋되지 않는다.
//    · 이후 신청은 저장된 세션을 재사용한다.
//
//   playwright-core 가 설치돼 있어야 하며(시스템 Edge 사용, 브라우저 다운로드 없음),
//   없으면 isAvailable()===false 로 도구가 비활성화된다.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const PROFILE_DIR = process.env.DATAGO_PROFILE || path.join(os.homedir(), '.datagokr-mcp', 'profile');
const BASE = 'https://www.data.go.kr';

let chromium = null;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  chromium = null;
}

export function isAvailable() {
  return chromium !== null;
}

export function profileDir() {
  return PROFILE_DIR;
}

async function openContext({ headless = true } = {}) {
  if (!chromium) throw new Error('playwright-core 가 설치돼 있지 않습니다. `npm install playwright-core` 후 사용하세요.');
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  // 기본: Playwright 번들 Chromium(사용자 Edge 프로필을 건드리지 않아 안전·안정).
  // DATAGO_BROWSER=msedge 로 시스템 Edge 를 쓸 수도 있다(별도 다운로드 불필요하나 Edge 실행 중이면 불안정).
  const opts = {
    headless,
    viewport: { width: 1280, height: 900 },
    locale: 'ko-KR',
    args: ['--no-first-run', '--no-default-browser-check'],
  };
  if (process.env.DATAGO_BROWSER === 'msedge') opts.channel = 'msedge';
  return chromium.launchPersistentContext(PROFILE_DIR, opts);
}

// 현재 세션이 로그인 상태인지 확인(비번 불필요).
export async function checkLogin() {
  const ctx = await openContext({ headless: true });
  try {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const loggedIn = await isLoggedIn(page);
    return { loggedIn };
  } finally {
    await ctx.close();
  }
}

async function isLoggedIn(page) {
  // 로그인 시 상단에 "로그아웃"/"마이페이지" 가 노출된다.
  try {
    const text = await page.locator('body').innerText({ timeout: 8000 });
    return /로그아웃|마이페이지|마이데이터/.test(text) && !/로그인\s*회원가입/.test(text.slice(0, 400));
  } catch {
    return false;
  }
}

// 사람이 직접 로그인(headful). 로그인될 때까지 폴링하다가 성공하면 저장 후 종료.
export async function interactiveLogin({ timeoutMs = 180000 } = {}) {
  const ctx = await openContext({ headless: false });
  try {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // 로그인 페이지로 유도
    try {
      await page.getByRole('link', { name: /로그인/ }).first().click({ timeout: 5000 });
    } catch { /* 이미 로그인 화면이거나 링크 형태가 다름 — 사용자가 직접 진행 */ }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await isLoggedIn(page)) {
        return { ok: true, message: '로그인 성공. 세션이 저장되었습니다.' };
      }
      await page.waitForTimeout(2000);
    }
    return { ok: false, message: '시간 초과: 로그인 창에서 직접 로그인한 뒤 다시 시도하세요.' };
  } finally {
    await ctx.close(); // 쿠키는 프로필에 영속 저장됨
  }
}

// 특정 오픈API 에 활용신청. idOrUrl 은 데이터 id(숫자) 또는 openapi.do URL.
export async function applyForApi({ idOrUrl, purpose = 'AI 개발 및 학습용', headless = true } = {}) {
  const url = toOpenApiUrl(idOrUrl);
  if (!url) throw new Error('데이터 id(숫자) 또는 openapi.do URL 을 넣어주세요.');

  const ctx = await openContext({ headless });
  const steps = [];
  try {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    steps.push(`페이지 열기: ${url}`);

    if (!(await isLoggedIn(page))) {
      return { ok: false, needLogin: true, message: '로그인 세션이 없습니다. 먼저 apply_login 도구로 로그인하세요.', steps };
    }

    // 1) 활용신청 버튼
    const applyBtn = page.getByRole('link', { name: /활용신청/ }).first()
      .or(page.getByRole('button', { name: /활용신청/ }).first());
    await applyBtn.click({ timeout: 15000 });
    steps.push('활용신청 클릭');
    await page.waitForLoadState('domcontentloaded');

    // 2) 활용목적 입력 (textarea 라벨/placeholder 가 다양 → 첫 textarea 에 입력)
    const purposeBox = page.locator('textarea').first();
    if (await purposeBox.count()) {
      await purposeBox.fill(purpose, { timeout: 8000 });
      steps.push('활용목적 입력');
    }

    // 3) 동의 체크박스 모두 체크
    const boxes = page.locator('input[type="checkbox"]');
    const n = await boxes.count();
    for (let i = 0; i < n; i++) {
      const b = boxes.nth(i);
      if (await b.isVisible().catch(() => false) && !(await b.isChecked().catch(() => false))) {
        await b.check({ timeout: 3000 }).catch(() => {});
      }
    }
    if (n) steps.push(`동의 체크 ${n}개`);

    // 4) 신청 버튼
    const submit = page.getByRole('button', { name: /^신청$|신청하기|활용신청/ }).first()
      .or(page.getByRole('link', { name: /^신청$|신청하기/ }).first());
    await submit.click({ timeout: 10000 });
    steps.push('신청 제출');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    const bodyText = await page.locator('body').innerText().catch(() => '');
    const ok = /신청이?\s*(완료|접수)|승인|정상|신청되었습니다/.test(bodyText);
    return {
      ok,
      message: ok ? '활용신청을 제출했습니다. (자동승인 API 면 바로, 아니면 심사 후 발급)' : '신청 버튼까지 진행했으나 완료 문구를 확인하지 못했습니다. 포털에서 결과를 확인하세요.',
      steps,
      pageHint: bodyText.replace(/\s+/g, ' ').slice(0, 300),
    };
  } finally {
    await ctx.close();
  }
}

// 마이페이지 개발계정에서 발급된 서비스 키 목록(이름/상태)만 긁어온다. (키 값은 노출 최소화)
export async function listMyApplications({ headless = true } = {}) {
  const ctx = await openContext({ headless });
  try {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/iim/api/selectAcountList.do`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!(await isLoggedIn(page))) {
      return { ok: false, needLogin: true, message: '로그인 세션이 없습니다. 먼저 apply_login.' };
    }
    const rows = await page.locator('table tbody tr').allInnerTexts().catch(() => []);
    const items = rows.map((r) => r.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 50);
    return { ok: true, count: items.length, items };
  } finally {
    await ctx.close();
  }
}

export function toOpenApiUrl(idOrUrl) {
  const v = String(idOrUrl || '').trim();
  if (/^\d+$/.test(v)) return `${BASE}/data/${v}/openapi.do`;
  if (/^https?:\/\/.*data\.go\.kr/.test(v)) return v;
  const m = v.match(/\/data\/(\d+)\//);
  if (m) return `${BASE}/data/${m[1]}/openapi.do`;
  return null;
}
