import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkNodeVersion, checkWritable, platformGuide, checkStdio, runSelfcheck } from '../src/selfcheck.js';

test('checkNodeVersion', () => {
  assert.equal(checkNodeVersion('20.0.0').ok, true);
  assert.equal(checkNodeVersion('22.11.0').ok, true);
  assert.equal(checkNodeVersion('18.19.1').ok, false);
});

test('checkWritable: 쓰기 가능/불가', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-'));
  assert.equal(checkWritable(path.join(dir, 'a')).ok, true);
  const file = path.join(dir, 'f'); fs.writeFileSync(file, 'x');
  assert.equal(checkWritable(path.join(file, 'sub')).ok, false); // 파일 아래에는 폴더를 못 만듦
});

test('platformGuide: OS 별 설정 경로', () => {
  assert.match(platformGuide('win32', { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'C:\\Users\\a'), /Windows.*claude_desktop_config\.json/s);
  assert.match(platformGuide('darwin', {}, '/Users/a'), /macOS.*Application Support/s);
  assert.match(platformGuide('linux', {}, '/home/a'), /Linux/);
});

test('실제 서버 기동: stdio', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-home-'));
  const a = await checkStdio(home); assert.equal(a.ok, true, a.detail);
});

test('runSelfcheck 전체가 0 으로 끝난다', async () => {
  const lines = [];
  assert.equal(await runSelfcheck({ log: (l) => lines.push(l) }), 0, lines.join('\n'));
  assert.ok(lines.some((l) => /모든 필수 점검 통과/.test(l)));
});
