process.env.DATAGO_ALLOW_LOCAL = '1';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/mcp.js';
import { createRegistry } from '../src/registry.js';
import { registerTools } from '../src/tools.js';
import { registerApplyTools } from '../src/tools-apply.js';
import { annotationsFor, annotateTools, TOOL_ANNOTATIONS } from '../src/annotations.js';

import os from 'node:os';
import path from 'node:path';
const require_tmp = () => path.join(os.tmpdir(), 'ann-never-written.json');
function full() {
  const s = createServer({});
  registerTools(s, { registry: createRegistry(require_tmp()) });
  registerApplyTools(s);
  s.tool('doctor', { description: 'd' }, async () => 'ok');
  annotateTools(s);
  return s;
}

test('모든 도구에 annotations 가 있고 tools/list 로 노출된다', async () => {
  const s = full();
  const res = await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.ok(res.result.tools.length >= 17); // playwright-core 없으면 apply_* 대신 apply_setup
  for (const t of res.result.tools) {
    assert.ok(t.annotations, `${t.name} 에 annotations 없음`);
    assert.equal(typeof t.annotations.readOnlyHint, 'boolean', t.name);
    assert.equal(typeof t.annotations.openWorldHint, 'boolean', t.name);
  }
});

test('읽기 전용 도구에는 destructive/idempotent 가 없고, 쓰기 도구에는 있다', () => {
  assert.deepEqual(annotationsFor('list_keys'), { readOnlyHint: true, openWorldHint: false });
  const rm = annotationsFor('remove_key');
  assert.equal(rm.readOnlyHint, false);
  assert.equal(rm.destructiveHint, true);
  assert.equal(rm.idempotentHint, true);
  assert.equal(annotationsFor('export_data').destructiveHint, true);
  assert.equal(annotationsFor('nope'), undefined);
});

test('표에 오타가 없다: 등록된 도구 이름만 (미구현 예정 도구 제외)', () => {
  const names = new Set(full().tools.keys());
  // apply_* 는 playwright-core 가 있을 때만 등록된다 (CI 에는 없을 수 있음)
  const planned = new Set(['apply_login', 'apply_status', 'apply_api', 'apply_get_key', 'my_applications']);
  for (const k of Object.keys(TOOL_ANNOTATIONS)) {
    assert.ok(names.has(k) || planned.has(k) || k === 'apply_setup', `표의 ${k} 는 등록되지 않음`);
  }
});
