import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const server = fileURLToPath(new URL('../bin/server.js', import.meta.url));
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'datago-e2e-'));

// 실제 프로세스를 띄워 stdio 로 JSON-RPC 를 주고받는다.
function runServer(lines, env = {}) {
  const dir = tmpDir();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [server], {
      env: { ...process.env, DATAGO_CONFIG: path.join(dir, 'c.json'), DATAGO_USAGE: path.join(dir, 'u.json'), DATAGO_HOME: path.join(dir, 'home'), ...env },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, err, messages: out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) }));
    child.stdin.end(lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
    setTimeout(() => { child.kill(); reject(new Error('서버가 종료되지 않음')); }, 15000).unref();
  });
}

test('e2e: initialize → tools/list → tools/call, stdin 종료 시 정상 종료', async () => {
  const { code, messages, err } = await runServer([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'explain_error', arguments: { code: '22' } } },
  ]);
  assert.equal(code, 0);
  assert.match(err, /\[datagokr-mcp\] v/);                       // 로그는 stderr 로만
  assert.equal(messages.length, 3);                               // notification 은 응답 없음
  assert.equal(messages[0].result.protocolVersion, '2025-06-18');
  const names = messages[1].result.tools.map((t) => t.name);
  for (const n of ['call_api', 'fetch_all', 'describe_api', 'search_datasets', 'doctor', 'quota_status']) assert.ok(names.includes(n), n);
  assert.match(messages[2].result.content[0].text, /트래픽|제한/);
});

test('e2e: 깨진 JSON 줄은 -32700 응답 후 계속 동작', async () => {
  const { messages } = await runServer([
    '{깨진 json',
    { jsonrpc: '2.0', id: 7, method: 'ping' },
  ]);
  assert.equal(messages[0].error.code, -32700);
  assert.deepEqual(messages[1], { jsonrpc: '2.0', id: 7, result: {} });
});

test('e2e: 키 저장 → 저장 파일 생성, list_keys 는 마스킹', async () => {
  const dir = tmpDir();
  const cfg = path.join(dir, 'c.json');
  const secret = 'SECRETKEYSECRETKEY1234567890abcd';
  const { messages } = await runServer([
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'save_key', arguments: { name: 'main', key: secret } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_keys', arguments: {} } },
  ], { DATAGO_CONFIG: cfg });
  assert.ok(fs.existsSync(cfg));
  const listText = messages.find((m) => m.id === 2).result.content[0].text;
  assert.doesNotMatch(listText, new RegExp(secret));              // 전체 키 노출 금지
  assert.match(listText, /SECR…abcd/);
});

test('e2e: --version / doctor 서브커맨드', async () => {
  const run = (args) => new Promise((resolve) => {
    const c = spawn(process.execPath, [server, ...args], { env: { ...process.env, DATAGO_CONFIG: path.join(tmpDir(), 'c.json'), DATAGO_USAGE: path.join(tmpDir(), 'u.json') } });
    let o = ''; c.stdout.on('data', (d) => { o += d; }); c.on('close', (code) => resolve({ code, o }));
  });
  const v = await run(['--version']);
  assert.match(v.o.trim(), /^\d+\.\d+\.\d+$/);
  const d = await run(['doctor']);
  assert.match(d.o, /Node\.js/);
});
