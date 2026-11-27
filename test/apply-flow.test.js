// apply_* 도구가 매번 "다음 단계(next)"와 영어 hint 를 돌려주는지, 스킬/README 가 실제 도구와 일치하는지
process.env.DATAGO_ALLOW_LOCAL = '1';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from '../src/mcp.js';
import { createRegistry } from '../src/registry.js';
import { registerTools } from '../src/tools.js';
import { registerApplyTools } from '../src/tools-apply.js';
import os from 'node:os';
import path from 'node:path';

const call = (s, name, args = {}) => s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }).then((r) => r.result);
const KEY = encodeURIComponent('FAKEFAKEFAKEfakeKEY+EXAMPLE/NOTAREALKEY0123456789abcdefghij==');
const base = { isAvailable: () => true };
const done = { total: 1, done: 1, already: 0, failed: 0, needLogin: false, skipped: 0, invalid: [], duplicates: [], results: [{ idOrUrl: '1', ok: true }] };

test('apply_login / apply_status: next 와 hint', async () => {
  const s = createServer({});
  registerApplyTools(s, { apply: { ...base, startLogin: async () => ({ message: '창을 열었어요.' }), checkLogin: async () => ({ loggedIn: false }) } });
  let r = await call(s, 'apply_login');
  assert.match(r.structuredContent.next, /apply_status/);
  assert.match(r.structuredContent.hint, /apply_status/);
  r = await call(s, 'apply_status');
  assert.equal(r.structuredContent.loggedIn, false);
  assert.match(r.structuredContent.next, /apply_login/);
  assert.match(r.content[0].text, /다음 단계/);
  const s2 = createServer({});
  registerApplyTools(s2, { apply: { ...base, checkLogin: async () => ({ loggedIn: true }) } });
  r = await call(s2, 'apply_status');
  assert.match(r.structuredContent.next, /apply_api/);
});

test('apply_api: 로그인 필요 / 키 저장 / 키 못 읽음 각각 다른 next', async () => {
  const mk = (applyResult, keyResult) => {
    const s = createServer({});
    registerApplyTools(s, { registry: { getKey: () => null, saveKey: () => ({ name: 'datago' }) },
      apply: { ...base, applyForApis: async () => applyResult, fetchServiceKey: async () => keyResult } });
    return s;
  };
  let r = await call(mk({ ...done, done: 0, failed: 0, needLogin: true, skipped: 1, results: [] }), 'apply_api', { idOrUrl: '15000314' });
  assert.match(r.structuredContent.next, /apply_login/);
  assert.match(r.structuredContent.hint, /apply_login/);
  r = await call(mk(done, { ok: true, keys: { encoding: KEY, decoding: decodeURIComponent(KEY) } }), 'apply_api', { idOrUrl: '15000314' });
  assert.match(r.structuredContent.next, /call_api/);
  r = await call(mk(done, { ok: false, message: '읽지 못함' }), 'apply_api', { idOrUrl: '15000314' });
  assert.match(r.structuredContent.next, /apply_get_key|save_key/);
  assert.match(r.structuredContent.key.message, /save_key/);
  assert.match(r.structuredContent.key.hint, /manually/);
  r = await call(mk({ ...done, done: 0, failed: 1, results: [{ idOrUrl: '1', ok: false, message: 'LINK' }] }), 'apply_api', { idOrUrl: '15000314' });
  assert.match(r.structuredContent.hint, /LINK/);
  r = await call(mk(done, {}), 'apply_api', {});
  assert.equal(r.isError, true);
  assert.ok(r.structuredContent.hint);
});

test('my_applications: 승인 건이 있으면 apply_get_key 안내, 파싱 실패는 hint', async () => {
  const mk = (res) => { const s = createServer({}); registerApplyTools(s, { apply: { ...base, listMyApplications: async () => res } }); return s; };
  let r = await call(mk({ needLogin: true }), 'my_applications');
  assert.match(r.structuredContent.next, /apply_login/);
  r = await call(mk({ total: 1, count: 1, items: [1], parsed: [{ name: 'A API', status: '승인' }], byStatus: { 승인: 1 } }), 'my_applications');
  assert.match(r.structuredContent.next, /apply_get_key/);
  assert.equal(r.structuredContent.items[0].status, '승인');
  r = await call(mk({ total: 0, count: 0, items: [], parsed: [], byStatus: {} }), 'my_applications');
  assert.equal(r.structuredContent.ok, true);
  assert.match(r.structuredContent.next, /apply_api/);
  r = await call(mk({ total: 2, count: 0, items: [], parsed: [], byStatus: {} }), 'my_applications');
  assert.equal(r.structuredContent.ok, false);
  assert.match(r.structuredContent.hint, /parsed/);
});

test('SKILL.md 와 README 가 언급한 도구는 모두 실제 server.tools 에 있다', () => {
  const s = createServer({});
  const reg = createRegistry(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'datago-')), 'c.json'));
  registerTools(s, { registry: reg });
  registerApplyTools(s, { apply: { ...base }, registry: reg });
  const names = new Set([...s.tools.keys(), 'doctor']);
  for (const f of ['../skills/datagokr/SKILL.md', '../README.md', '../README.ko.md']) {
    const text = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    const used = new Set([...text.matchAll(/\b((?:apply|my|find|describe|search|call|fetch|export|save|list|remove|set|explain|quota)_[a-z_]+)\b/g)].map((m) => m[1]));
    for (const u of used) {
      if (['apply_setup'].includes(u) || names.has(u)) continue;
      assert.fail(`${f} 가 존재하지 않는 도구를 언급: ${u}`);
    }
  }
});
