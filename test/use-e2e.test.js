// use_api 전체 흐름을 실제 Playwright(헤드리스 Chromium) + 로컬 가짜 포털로 끝까지. 실제 data.go.kr 이 아니다.
// Chromium 이 없으면 건너뛰되, DATAGO_REQUIRE_BROWSER=1 (CI browser 잡)이면 실패한다.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakePortal, USE_PK, FAKE_COOKIE, FAKE_ENC, FAKE_DEC } from './helpers/fake-portal.js';

const portal = await startFakePortal();
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'datago-use-e2e-'));
process.env.DATAGO_ALLOW_LOCAL = '1';
process.env.DATAGO_HOME = home;
process.env.DATAGO_BASE_URL = portal.url;
delete process.env.DATAGO_STATE;
const apply = await import('../src/apply.js');
const { createUse } = await import('../src/tools-use.js');
const { createRegistry } = await import('../src/registry.js');
const skip = apply.browserInstalled() ? false : 'Chromium 미설치';
if (skip && process.env.DATAGO_REQUIRE_BROWSER === '1') throw new Error(`DATAGO_REQUIRE_BROWSER=1 인데 브라우저 테스트를 실행할 수 없어요: ${skip}`);

const login = () => fs.writeFileSync(path.join(home, 'storage-state.json'), JSON.stringify({
  cookies: [{ name: FAKE_COOKIE, value: 'ok', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [],
}));
before(login);
after(async () => { await portal.close(); fs.rmSync(home, { recursive: true, force: true }); });
beforeEach(() => {
  Object.assign(portal.state, { expired: null, keyPage: 'inputs', listKeyPage: 'none', preApproved: false, activated: true, apiCode: '00' });
  portal.state.submissions.length = 0; portal.state.apiRequests.length = 0;
});
const fresh = () => {
  const registry = createRegistry(path.join(fs.mkdtempSync(path.join(home, 'r-')), 'c.json'));
  return { registry, use: createUse({ registry, apply, sleep: async () => {} }) };
};
const noKey = (o) => { const s = JSON.stringify(o); assert.ok(!s.includes(FAKE_ENC) && !s.includes(FAKE_DEC), 'key leaked'); };

test('e2e use_api: dryRun 은 포털에 아무것도 제출하지 않는다', { skip }, async () => {
  const { use, registry } = fresh();
  const out = await use({ idOrUrl: USE_PK.normal, dryRun: true });
  assert.equal(out.status, 'dry_run');
  assert.equal(out.loggedIn, true);
  assert.equal(portal.state.submissions.length + portal.state.apiRequests.length, 0);
  assert.equal(registry.getFlow(USE_PK.normal), null);
});

test('e2e use_api: confirm 없이는 미제출, confirm 으로 신청→키→시험호출→별칭→예시', { skip }, async () => {
  const { use, registry } = fresh();
  assert.equal((await use({ idOrUrl: USE_PK.normal })).status, 'needs_confirm');
  assert.equal(portal.state.submissions.length, 0);
  const out = await use({ idOrUrl: USE_PK.normal, confirm: true });
  assert.equal(out.status, 'ready', out.message);
  assert.equal(portal.state.submissions.length, 1);
  assert.equal(registry.getKey('datago'), FAKE_ENC);
  assert.equal(portal.state.apiRequests.at(-1).solYear, '2019');
  assert.deepEqual(out.preview, [{ dateName: '가짜 항목' }]);
  assert.equal(registry.getEndpoint(out.alias).url, `${portal.url}/openapi/fake/getThing`);
  assert.match(out.example.curl, /DATAGO_SERVICE_KEY/);
  noKey(out);
});

test('e2e use_api: 승인 반영 전(30)이면 pending, 반영 뒤 다시 실행하면 재신청 없이 ready', { skip }, async () => {
  const { use } = fresh();
  portal.state.activated = false;
  const p = await use({ idOrUrl: USE_PK.normal, confirm: true });
  assert.equal(p.status, 'pending_activation', p.message);
  assert.equal(p.retryInMinutes, 60);
  noKey(p);
  portal.state.activated = true;
  const r = await use({ idOrUrl: USE_PK.normal });
  assert.equal(r.status, 'ready', r.message);
  assert.equal(portal.state.submissions.length, 1);
});

test('e2e use_api: 세션 만료 → needs_login, LINK형 → unsupported, 샘플 없는 필수변수 → need_params', { skip }, async () => {
  const { use } = fresh();
  portal.state.expired = 'redirect';
  assert.equal((await use({ idOrUrl: USE_PK.normal, confirm: true })).status, 'needs_login');
  assert.equal(portal.state.submissions.length, 0);
  portal.state.expired = null;
  assert.equal((await use({ idOrUrl: USE_PK.link, confirm: true })).status, 'unsupported');
  const np = await fresh().use({ idOrUrl: USE_PK.noSample, confirm: true });
  assert.equal(np.status, 'need_params', np.message);
  assert.deepEqual(np.missingParams, ['solYear']);
});
