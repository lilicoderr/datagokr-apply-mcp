import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { runDoctor, formatReport, exitCode, nodeMajor } from '../src/doctor.js';
import { createRegistry } from '../src/registry.js';
import { createUsage } from '../src/usage.js';

const tmp = (n) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'datago-')), n);
const okFetch = async () => ({ status: 200 });
const byId = (rs, id) => rs.find((r) => r.id === id);
const fakeApply = (o = {}) => ({
  isAvailable: () => true, browserInstalled: () => true, hasSession: () => true, stateFile: () => '/x/state.json', ...o,
});

test('nodeMajor', () => {
  assert.equal(nodeMajor('22.3.1'), 22);
  assert.equal(nodeMajor('18.0.0'), 18);
});

test('doctor: 오래된 Node 는 fail', async () => {
  const rs = await runDoctor({ nodeVersion: '18.19.0', fetchImpl: okFetch });
  assert.equal(byId(rs, 'node').status, 'fail');
  assert.equal(exitCode(rs), 1);
});

test('doctor: 설정 파일 없음 → 첫 사용 안내(warn)', async () => {
  const rs = await runDoctor({ registry: createRegistry(tmp('none.json')), fetchImpl: okFetch });
  assert.equal(byId(rs, 'config').status, 'warn');
  assert.match(byId(rs, 'config').fix, /save_key/);
  assert.equal(exitCode(rs), 0);
});

test('doctor: 키 형태(Encoding/Decoding)를 보여주되 키 값은 노출하지 않음', async () => {
  const reg = createRegistry(tmp('c.json'));
  reg.saveKey('enc', 'abcdefghij%2Bklmnopqrstuvwxyz');
  reg.saveKey('dec', 'abcdefghij+klmnopqrstuvwxyz==');
  const rs = await runDoctor({ registry: reg, fetchImpl: okFetch });
  const k = byId(rs, 'keys');
  assert.equal(k.status, 'ok');
  assert.match(k.detail, /enc\[Encoding\]/);
  assert.match(k.detail, /dec\[Decoding\]/);
  assert.doesNotMatch(JSON.stringify(rs), /klmnopqrstuvwxyz/);
});

test('doctor: 네트워크 실패는 fail', async () => {
  const rs = await runDoctor({ fetchImpl: async () => { const e = new TypeError('x'); e.cause = { code: 'ENOTFOUND' }; throw e; } });
  assert.equal(byId(rs, 'network').status, 'fail');
  assert.match(byId(rs, 'network').detail, /ENOTFOUND/);
});

test('doctor: playwright 없음 → 선택 기능이라 warn (exit 0)', async () => {
  const rs = await runDoctor({ apply: fakeApply({ isAvailable: () => false }), fetchImpl: okFetch });
  assert.equal(byId(rs, 'playwright').status, 'warn');
  assert.equal(exitCode(rs), 0);
});

test('doctor: 브라우저 미설치는 fail + 설치 명령 안내', async () => {
  const rs = await runDoctor({ apply: fakeApply({ browserInstalled: () => false }), fetchImpl: okFetch });
  assert.equal(byId(rs, 'chromium').status, 'fail');
  assert.match(byId(rs, 'chromium').fix, /install chromium/);
});

test('doctor: 세션 없으면 apply_login 안내', async () => {
  const rs = await runDoctor({ apply: fakeApply({ hasSession: () => false }), fetchImpl: okFetch });
  assert.match(byId(rs, 'session').fix, /apply_login/);
});

test('doctor: 호출량 80% 이상이면 경고', async () => {
  const usage = createUsage(tmp('u.json'));
  for (let i = 0; i < 900; i++) usage.record('main');
  const rs = await runDoctor({ usage, fetchImpl: okFetch });
  assert.equal(byId(rs, 'usage').status, 'warn');
});

test('formatReport: 요약 문구', () => {
  assert.match(formatReport([{ id: 'a', status: 'ok', title: 'A', detail: 'd' }]), /모두 정상/);
  assert.match(formatReport([{ id: 'a', status: 'fail', title: 'A', detail: 'd', fix: 'do x' }]), /→ do x[\s\S]*문제 1건/);
});
