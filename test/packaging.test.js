// 배포물 점검: npm pack 파일 목록, CHANGELOG/버전 일치, bin 엔트리
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8'));

test('npm pack --dry-run: 필요한 파일만(테스트·fixture·세션/키 파일 제외)', () => {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  let raw;
  try {
    raw = execFileSync(npm, ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
  } catch (e) { return; /* npm 을 못 돌리는 환경은 건너뜀 */ }
  const files = JSON.parse(raw)[0].files.map((f) => f.path);
  for (const must of ['bin/server.js', 'src/tools.js', 'src/portal.js', 'src/errorhints.js', 'skills/datagokr/SKILL.md', 'package.json', 'README.md', 'LICENSE', 'CHANGELOG.md']) {
    assert.ok(files.includes(must), `누락: ${must}`);
  }
  const bad = files.filter((f) => /^(test|scripts|node_modules|\.github)\//.test(f) || /(^|\/)(config\.json|\.datago|cookies|credentials|storage|.*-profile)/i.test(f) || f.startsWith('_'));
  assert.deepEqual(bad, []);
  assert.ok(files.length < 60, `파일이 너무 많음: ${files.length}`);
});

test('bin 엔트리/shebang, engines, 선택 의존성', () => {
  assert.equal(pkg.bin['datagokr-apply-mcp'], 'bin/server.js');
  assert.match(fs.readFileSync(new URL('bin/server.js', root), 'utf8'), /^#!\/usr\/bin\/env node/);
  assert.equal(pkg.engines.node, '>=20');
  assert.deepEqual(Object.keys(pkg.dependencies || {}), []); // 런타임 의존성 0
  assert.ok(pkg.optionalDependencies['playwright-core']);
});

test('CHANGELOG 최상단 버전이 package.json 과 같다', () => {
  const m = fs.readFileSync(new URL('CHANGELOG.md', root), 'utf8').match(/^## \[(\d+\.\d+\.\d+)\]/m);
  assert.equal(m?.[1], pkg.version);
});
