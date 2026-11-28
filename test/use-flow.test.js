// use_api 흐름: 확인 없이는 제출하지 않음, 이어 하기, 덮어쓰지 않기, 키 비노출
process.env.DATAGO_ALLOW_LOCAL = '1';
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, DEC, ENC, OLD, ENDPOINT } from './helpers/use-mocks.js';

const A = { idOrUrl: '15000001' };
const noKeyIn = (out) => { const s = JSON.stringify(out); assert.ok(!s.includes(ENC) && !s.includes(DEC) && !s.includes(OLD), s); };

test('dryRun: confirm 이 함께 있어도 신청·저장·호출이 없다', async () => {
  const { use, world, registry } = setup();
  const out = await use({ ...A, dryRun: true, confirm: true });
  assert.equal(out.status, 'dry_run');
  assert.equal(out.plan.dataId, '15000001');
  assert.deepEqual([world.applied.length, world.retrieved, world.calls.length], [0, 0, 0]);
  assert.deepEqual([registry.listKeys().keys, registry.listEndpoints(), registry.getFlow('15000001')], [{}, {}, null]);
});

test('confirm 없이는 제출하지 않고 plan 과 다음 단계를 준다', async () => {
  const { use, world } = setup();
  const out = await use(A);
  assert.equal(out.status, 'needs_confirm');
  assert.match(out.next, /confirm: true/);
  assert.equal(out.plan.autoApprove, true);
  assert.equal(world.applied.length, 0);
});

test('로그인 안 됨 → apply_login, 자동화 미설치 → needs_setup', async () => {
  const a = setup({ loggedIn: false });
  const out = await a.use({ ...A, confirm: true });
  assert.deepEqual([out.status, out.next, a.world.applied.length], ['needs_login', 'apply_login', 0]);
  const b = setup({ available: false });
  assert.equal((await b.use({ ...A, confirm: true })).status, 'needs_setup');
});

test('신청 → 반영 지연(30) → 다시 실행하면 재신청 없이 ready, 예시에 키 없음', async () => {
  const { use, world, registry } = setup();
  const p = await use({ ...A, confirm: true });
  assert.equal(p.status, 'pending_activation', p.message);
  assert.equal(p.retryInMinutes, 60);
  assert.equal(p.retryAfter, '2030-01-01T01:00:00.000Z');
  assert.equal(registry.getKey('datago'), ENC);
  noKeyIn(p);

  world.code = '00';
  world.clock += 3600000;
  const r = await use(A); // confirm 불필요: 이미 제출됨
  assert.equal(r.status, 'ready', r.message);
  assert.equal(world.applied.length, 1);
  assert.equal(world.retrieved, 1);
  assert.deepEqual(r.example.call_api, { endpoint: 'api-15000001', params: { solYear: '2019' } });
  assert.equal(registry.getEndpoint('api-15000001').url, ENDPOINT);
  assert.deepEqual(r.preview, [{ a: 1 }]);
  assert.match(r.example.curl, /serviceKey=\$\{DATAGO_SERVICE_KEY\}/);
  assert.match(r.example.js, /process\.env\.DATAGO_SERVICE_KEY/);
  noKeyIn(r);
});

test('3시간이 지나도 거부되면 my_applications 확인을 권한다', async () => {
  const { use, world } = setup();
  await use({ ...A, confirm: true });
  world.clock += 4 * 3600000;
  const out = await use(A);
  assert.deepEqual([out.status, out.overdue, out.next], ['pending_activation', true, 'my_applications']);
  const again = await use({ ...A, reapply: true });
  assert.equal(again.status, 'needs_confirm');
  assert.equal(world.applied.length, 1);
});

test('저장된 키가 되면 신청하지 않고, 같은 이름의 다른 키·별칭은 덮어쓰지 않는다', async () => {
  const ok = setup();
  ok.registry.saveKey('mine', OLD);
  ok.registry.saveEndpoint('api-15000001', 'https://apis.data.go.kr/other', '내 것');
  ok.world.code = '00';
  const out = await ok.use(A);
  assert.deepEqual([out.status, out.alias, ok.world.applied.length], ['ready', 'api-15000001-2', 0]);
  assert.equal(ok.registry.getEndpoint('api-15000001').url, 'https://apis.data.go.kr/other');

  const no = setup(); // 저장된 키가 거부 → 신청 → 새 키는 datago-2 로
  no.registry.saveKey('datago', OLD);
  assert.equal((await no.use(A)).status, 'needs_confirm');
  const p = await no.use({ ...A, confirm: true });
  assert.equal(p.keyName, 'datago-2');
  assert.equal(no.registry.getKey('datago'), OLD);
  assert.equal(p.example.call_api.keyName, 'datago-2');
  noKeyIn(p);
});
