process.env.DATAGO_ALLOW_LOCAL = '1';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUseArgs, runUseCli, exitCodeFor } from '../src/cli-use.js';
import { setup } from './helpers/use-mocks.js';

test('parseUseArgs: 옵션/param 파싱, 잘못된 입력은 오류', () => {
  const a = parseUseArgs(['15000001', '--confirm', '--param', 'solYear=2025', '--alias', 'h', '--key-name', 'k2']);
  assert.deepEqual([a.idOrUrl, a.confirm, a.params, a.alias, a.keyName], ['15000001', true, { solYear: '2025' }, 'h', 'k2']);
  assert.throws(() => parseUseArgs([]), /사용법/);
  assert.throws(() => parseUseArgs(['1', '--nope']), /알 수 없는/);
  assert.throws(() => parseUseArgs(['1', '--param', 'x']), /key=value/);
  assert.throws(() => parseUseArgs(['1', '--alias']), /값이 필요/);
});

test('CLI: --confirm 없이는 제출하지 않고 종료코드 2, --dry-run 은 0', async () => {
  const s = setup(); const lines = [];
  const log = (l) => lines.push(l);
  assert.equal(await runUseCli(['15000001', '--json'], s.deps, { log }), 2);
  assert.equal(JSON.parse(lines[0]).status, 'needs_confirm');
  assert.equal(await runUseCli(['15000001', '--dry-run', '--json'], s.deps, { log }), 0);
  assert.equal(s.world.applied.length, 0);
  assert.equal(exitCodeFor({ status: 'call_failed' }), 1);
});

test('CLI: --confirm 으로 신청하고 --json 에 키가 없다', async () => {
  const s = setup(); s.world.code = '00'; const lines = [];
  assert.equal(await runUseCli(['15000001', '--confirm', '--json'], s.deps, { log: (l) => lines.push(l) }), 0);
  assert.equal(JSON.parse(lines[0]).status, 'ready');
  assert.ok(!lines[0].includes('FAKEFAKE'));
});
