// 실제 Playwright(헤드리스 Chromium)로 신청 흐름을 끝까지 돌린다. 상대는 test/helpers/fake-portal.js 의
// 가짜 포털이며 실제 data.go.kr 이 아니다. Chromium 이 없으면 건너뛴다.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakePortal, SCENARIO as S, FAKE_COOKIE, FAKE_ENC, FAKE_DEC, FAKE_HEX } from './helpers/fake-portal.js';
import { createServer } from '../src/mcp.js';
import { createRegistry } from '../src/registry.js';

const portal = await startFakePortal();
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'datago-e2e-'));
process.env.DATAGO_ALLOW_LOCAL = '1';
process.env.DATAGO_HOME = home;
process.env.DATAGO_BASE_URL = portal.url;
delete process.env.DATAGO_STATE;
// apply.js 는 불러올 때 주소를 정하므로, env 를 설정한 뒤에 import 한다 (tools-apply 가 apply.js 를 import 함).
const apply = await import('../src/apply.js');
const { registerApplyTools } = await import('../src/tools-apply.js');
const skip = apply.browserInstalled() ? false : 'Chromium 미설치';

before(() => {
  fs.writeFileSync(path.join(home, 'storage-state.json'), JSON.stringify({
    cookies: [{ name: FAKE_COOKIE, value: 'ok', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }],
    origins: [],
  }));
});
after(async () => { await portal.close(); fs.rmSync(home, { recursive: true, force: true }); });
beforeEach(() => { Object.assign(portal.state, { expired: null, keyPage: 'inputs', listKeyPage: 'none' }); portal.state.submissions.length = 0; });

const run = (pk, opts = {}) => apply.applyForApi({ idOrUrl: pk, ...opts });

test('가짜 포털을 실제로 가리킨다', () => {
  assert.equal(apply.toOpenApiUrl('1'), `${portal.url}/data/1/openapi.do`);
});

test('e2e 성공: 목적/동의가 서버에 도착', { skip }, async () => {
  const r = await run(S.success);
  assert.equal(r.ok, true, r.message);
  assert.equal(r.already, false);
  assert.deepEqual(portal.state.submissions, [{ pk: S.success, purpose: apply.DEFAULT_PURPOSE, agree: 'on' }]);
});

test('e2e 동의 항목 없음 / 이미 체크됨 / 느린 응답도 성공', { skip }, async () => {
  for (const pk of [S.noAgreement, S.preChecked, S.slow]) {
    const r = await run(pk);
    assert.equal(r.ok, true, `${pk}: ${r.message}`);
  }
  assert.equal(portal.state.submissions.length, 3);
});

test('e2e 빈 활용목적은 기본 문구로', { skip }, async () => {
  assert.equal((await run(S.success, { purpose: '  ' })).ok, true);
});

test('e2e 이미 신청: 폼 진입 시 / 제출 시 알림 모두 already', { skip }, async () => {
  for (const pk of [S.alreadyOnLoad, S.alreadyOnSubmit]) {
    const r = await run(pk);
    assert.equal(r.already, true, `${pk}: ${r.message}`);
    assert.equal(r.ok, false);
  }
});

test('e2e 검증 거절: 성공으로 위장하지 않고 포털 문구를 전달', { skip }, async () => {
  const cases = [[S.otherAgreement, /동의해 주세요/], [S.shortPurpose, /5자 이상/], [S.notCompleted, /완료되지 않았/], [S.confirmSaysDone, /완료되지 않았/]];
  for (const [pk, re] of cases) {
    const r = await run(pk);
    assert.equal(r.ok, false, `${pk}: ${r.message}`);
    assert.equal(r.already, false);
    assert.match(r.message, re);
  }
  assert.equal(portal.state.submissions.length, 0);
});

test('e2e 버튼 없음 / LINK형', { skip }, async () => {
  const b = await run(S.buttonMissing);
  assert.equal(b.ok, false);
  assert.equal(b.failedStep, '제출');
  const l = await run(S.linkType);
  assert.equal(l.ok, false);
  assert.ok(!l.needLogin);
  assert.match(l.message, /LINK/);
});

test('e2e 세션 만료: 리다이렉트 / 알림창 / 제출 도중 모두 needLogin', { skip }, async () => {
  assert.equal((await run(S.expireOnSubmit)).needLogin, true);
  for (const mode of ['redirect', 'alert']) {
    portal.state.expired = mode;
    assert.equal((await run(S.success)).needLogin, true, mode);
    assert.equal((await apply.checkLogin()).loggedIn, false, mode);
    assert.equal((await apply.listMyApplications()).needLogin, true, mode);
    assert.equal((await apply.fetchServiceKey()).needLogin, true, mode);
  }
  assert.equal(portal.state.submissions.length, 0);
});

test('e2e 일괄: 세션 만료면 나머지를 건너뜀, 정상이면 건별 집계', { skip }, async () => {
  const r = await apply.applyForApis([S.success, S.alreadyOnLoad, S.buttonMissing], { delayMs: 0 });
  assert.deepEqual([r.done, r.already, r.failed], [1, 1, 1]);
  portal.state.expired = 'redirect';
  const x = await apply.applyForApis([S.success, S.noAgreement], { delayMs: 0 });
  assert.equal(x.needLogin, true);
  assert.equal(x.skipped, 1);
});

test('e2e 마이페이지 목록: 메뉴 링크를 신청 항목으로 세지 않음', { skip }, async () => {
  assert.equal((await apply.checkLogin()).loggedIn, true);
  const r = await apply.listMyApplications();
  assert.equal(r.total, 2);
  assert.deepEqual(r.byStatus, { 승인: 1, 신청: 1 });
});

test('e2e 개발계정 키 페이지 변형', { skip }, async () => {
  for (const [variant, enc, dec] of [['inputs', FAKE_ENC, FAKE_DEC], ['headerRow', FAKE_ENC, FAKE_DEC], ['entities', FAKE_ENC, FAKE_DEC],
    ['farLabel', FAKE_ENC, FAKE_DEC], ['hex', FAKE_HEX, FAKE_HEX]]) {
    portal.state.keyPage = variant;
    const r = await apply.fetchServiceKey();
    assert.deepEqual(r.keys, { encoding: enc, decoding: dec }, `${variant}: ${r.message}`);
  }
  Object.assign(portal.state, { keyPage: '404', listKeyPage: 'inputs' }); // 두 번째 후보 페이지
  assert.equal((await apply.fetchServiceKey()).keys.encoding, FAKE_ENC);
  for (const variant of ['truncated', 'none']) {
    Object.assign(portal.state, { keyPage: variant, listKeyPage: 'none' });
    const r = await apply.fetchServiceKey();
    assert.equal(r.ok, false, variant);
    assert.equal(r.keys, undefined);
    assert.match(r.message, /save_key/);
  }
});

test('e2e MCP 도구: apply_api → 키 저장(마스킹), 원문은 출력에 없음', { skip }, async () => {
  const s = createServer({});
  const registry = createRegistry(path.join(home, 'config.json'));
  registerApplyTools(s, { apply, registry });
  const res = await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'apply_api', arguments: { idOrUrl: S.success } } });
  const out = res.result.structuredContent;
  assert.equal(out.done, 1, out.message);
  assert.equal(out.key.saved, true, out.key.message);
  assert.equal(registry.getKey('datago'), FAKE_ENC);
  assert.match(out.next, /call_api/);
  const dumped = JSON.stringify(res);
  assert.ok(!dumped.includes(FAKE_ENC) && !dumped.includes(FAKE_DEC));
});
