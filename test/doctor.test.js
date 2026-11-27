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

import { applyFixes, formatFixes } from '../src/doctor.js';
import { createRegistry as mkReg } from '../src/registry.js';

test('applyFixes: 설정 파일 생성(config), 이미 있으면 그대로', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'datago-fix-'));
  const reg = mkReg(path.join(dir, 'cfg.json'));
  const acts = await applyFixes([{ id: 'config', status: 'warn' }], { registry: reg });
  assert.equal(acts[0].ok, true);
  assert.ok(fs.existsSync(reg.file));
  assert.equal(reg.init(), false);
});

test('applyFixes: ok 항목은 건드리지 않고, chromium 은 주입된 명령 실행', async () => {
  const calls = [];
  const runCommand = async (cmd, args) => { calls.push([cmd, ...args]); return 0; };
  const acts = await applyFixes([
    { id: 'node', status: 'ok' },
    { id: 'chromium', status: 'fail' },
    { id: 'session', status: 'warn' },
  ], { runCommand });
  assert.deepEqual(calls, [['npx', 'playwright-core', 'install', 'chromium']]);
  assert.equal(acts.length, 1);
  assert.match(formatFixes(acts), /Chromium 설치 완료/);
});

test('applyFixes: 설치 실패/예외는 ok=false 로 보고, 고칠 게 없으면 안내', async () => {
  const bad = await applyFixes([{ id: 'chromium', status: 'fail' }], { runCommand: async () => 1 });
  assert.equal(bad[0].ok, false);
  const thrown = await applyFixes([{ id: 'chromium', status: 'fail' }], { runCommand: async () => { throw new Error('boom'); } });
  assert.equal(thrown[0].msg, 'boom');
  assert.match(formatFixes([]), /고칠 수 있는 항목이 없어요/);
});

test('applyFixes: perm 은 POSIX 에서만 chmod 600', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'datago-fix-'));
  const reg = mkReg(path.join(dir, 'cfg.json'));
  reg.init();
  const win = await applyFixes([{ id: 'perm', status: 'warn' }], { registry: reg, platform: 'win32' });
  assert.equal(win.length, 0);
  if (process.platform !== 'win32') {
    fs.chmodSync(reg.file, 0o644);
    const posix = await applyFixes([{ id: 'perm', status: 'warn' }], { registry: reg, platform: 'linux' });
    assert.equal(posix[0].ok, true);
    assert.equal(fs.statSync(reg.file).mode & 0o777, 0o600);
  }
});
