// 설치 검증 (npm run selfcheck) — Windows/macOS/Linux 공통.
// 실제로 서버를 띄워 보고(stdio, HTTP) 설치 가이드대로 동작하는지 확인한다. 네트워크·키·로그인은 필요 없다.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopConfigPath } from './printconfig.js';

const SERVER = fileURLToPath(new URL('../bin/server.js', import.meta.url));
const rpc = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';

export function checkNodeVersion(version = process.versions.node) {
  const major = Number(version.split('.')[0]);
  return major >= 20
    ? { ok: true, detail: `Node ${version}` }
    : { ok: false, detail: `Node ${version} — 20 이상이 필요합니다 (https://nodejs.org)` };
}

function childEnv(home) {
  return { ...process.env, DATAGO_CONFIG: path.join(home, 'cfg.json'), DATAGO_USAGE: path.join(home, 'usage.json'),
    DATAGO_WATCH: path.join(home, 'watch.json'), DATAGO_HOME: path.join(home, 'session'), DATAGO_HTTP_TOKEN: '' };
}

// stdio: initialize → tools/list 왕복
export function checkStdio(home, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [SERVER], { env: childEnv(home), stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = ''; const timer = setTimeout(() => { p.kill(); resolve({ ok: false, detail: '시간 초과' }); }, timeoutMs);
    p.stdout.on('data', (d) => { buf += d; });
    p.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, detail: e.message }); });
    p.on('close', () => {
      clearTimeout(timer);
      try {
        const lines = buf.trim().split('\n').map((l) => JSON.parse(l));
        const tools = lines.find((l) => l.id === 2)?.result?.tools;
        resolve(tools?.length ? { ok: true, detail: `stdio OK — 도구 ${tools.length}개` } : { ok: false, detail: 'tools/list 응답 없음' });
      } catch { resolve({ ok: false, detail: `stdout 이 JSON-RPC 가 아님: ${buf.slice(0, 80)}` }); }
    });
    p.stdin.end(rpc(1, 'initialize', { protocolVersion: '2025-06-18' }) + rpc(2, 'tools/list'));
  });
}

// HTTP: 임의 포트에 --http 로 띄워 ping
export function checkHttp(home, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [SERVER, '--http', '--port', '0'], { env: childEnv(home), stdio: ['ignore', 'ignore', 'pipe'] });
    let done = false; let err = '';
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); p.kill(); resolve(r); } };
    const timer = setTimeout(() => finish({ ok: false, detail: `HTTP 시간 초과 ${err.slice(0, 80)}` }), timeoutMs);
    p.on('error', (e) => finish({ ok: false, detail: e.message }));
    p.stderr.on('data', async (d) => {
      err += d;
      const m = /http:\/\/([\d.]+):(\d+)\/mcp/.exec(err);
      if (!m) return;
      try {
        const res = await fetch(`http://${m[1]}:${m[2]}/mcp`, { method: 'POST', body: rpc(1, 'ping') });
        finish(res.ok && m[1] === '127.0.0.1' ? { ok: true, detail: 'HTTP OK (127.0.0.1 전용)' } : { ok: false, detail: `HTTP ${res.status} @ ${m[1]}` });
      } catch (e) { finish({ ok: false, detail: e.message }); }
    });
  });
}

export function checkWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `.selfcheck-${process.pid}`);
    fs.writeFileSync(f, 'x'); fs.unlinkSync(f);
    return { ok: true, detail: `쓰기 가능: ${dir}` };
  } catch (e) { return { ok: false, detail: `${dir} 에 쓸 수 없음: ${e.code || e.message}` }; }
}

export function platformGuide(platform = process.platform, env = process.env, home = os.homedir()) {
  const cfg = desktopConfigPath(platform, env, home);
  const name = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[platform] || platform;
  return `${name}: Claude Desktop 설정 파일 → ${cfg}\n  스니펫: node ${path.relative(process.cwd(), SERVER) || 'bin/server.js'} --print-config claude-desktop`;
}

export async function runSelfcheck({ log = console.log } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'datago-selfcheck-'));
  const optionalPw = (await import('./apply.js')).isAvailable();
  const checks = [
    ['Node 버전', checkNodeVersion()],
    ['서버 stdio', await checkStdio(home)],
    ['서버 HTTP', await checkHttp(home)],
    ['홈 폴더 쓰기', checkWritable(path.join(home, 'w'))],
    ['playwright-core(선택)', { ok: true, detail: optionalPw ? '설치됨 — 활용신청 자동화 사용 가능' : '미설치 — 활용신청 자동화를 쓰려면 npm i playwright-core && npx playwright-core install chromium' }],
  ];
  for (const [name, r] of checks) log(`${r.ok ? 'OK  ' : 'FAIL'} ${name}: ${r.detail}`);
  log(`\n${platformGuide()}`);
  fs.rmSync(home, { recursive: true, force: true });
  const failed = checks.filter(([, r]) => !r.ok).length;
  log(failed ? `\n${failed}개 항목 실패 — 위 안내를 확인하세요.` : '\n모든 필수 점검 통과.');
  return failed ? 1 : 0;
}
