import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from '../src/mcp.js';
import { createRegistry } from '../src/registry.js';
import { registerTools, extractDatasetCards } from '../src/tools.js';

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'datago-')), 'cfg.json');
}

// ── MCP 프로토콜 ──
test('initialize 핸드셰이크', async () => {
  const s = createServer({ name: 'test', version: '1.2.3' });
  const res = await s.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
  assert.equal(res.result.protocolVersion, '2024-11-05');
  assert.equal(res.result.serverInfo.name, 'test');
  assert.ok(res.result.capabilities.tools);
});

test('알 수 없는 프로토콜 버전은 기본값으로', async () => {
  const s = createServer();
  const res = await s.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  assert.equal(res.result.protocolVersion, '2024-11-05');
});

test('notification 은 응답 없음(null)', async () => {
  const s = createServer();
  assert.equal(await s.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('tools/list 와 tools/call', async () => {
  const s = createServer();
  s.tool('echo', { description: '되돌려줌' }, async (a) => `got: ${a.msg}`);
  const list = await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(list.result.tools[0].name, 'echo');
  const call = await s.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo', arguments: { msg: '안녕' } } });
  assert.equal(call.result.content[0].text, 'got: 안녕');
});

test('도구 내부 오류는 isError 결과로', async () => {
  const s = createServer();
  s.tool('boom', {}, async () => { throw new Error('터짐'); });
  const res = await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'boom' } });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /터짐/);
});

test('없는 도구/메서드는 JSON-RPC 에러', async () => {
  const s = createServer();
  const a = await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nope' } });
  assert.equal(a.error.code, -32602);
  const b = await s.handle({ jsonrpc: '2.0', id: 2, method: 'foo/bar' });
  assert.equal(b.error.code, -32601);
});

// ── 레지스트리 ──
test('레지스트리: 키 저장/기본/마스킹/엔드포인트', () => {
  const reg = createRegistry(tmpFile());
  reg.saveKey('main', 'abcd1234efgh5678', '메인');
  assert.equal(reg.getKey(), 'abcd1234efgh5678');      // 기본 키
  assert.equal(reg.getKey('main'), 'abcd1234efgh5678');
  const listed = reg.listKeys();
  assert.equal(listed.defaultKey, 'main');
  assert.match(listed.keys.main.masked, /abcd…5678/);
  reg.saveEndpoint('bus', 'http://api/bus', '버스', { numOfRows: 10 });
  assert.equal(reg.getEndpoint('bus').url, 'http://api/bus');
  assert.equal(reg.removeKey('main'), true);
  assert.equal(reg.getKey('main'), null);
});

// ── 도구 통합 ──
test('registerTools: 전체 도구 등록 + call_api 가 저장 키 사용', async () => {
  const reg = createRegistry(tmpFile());
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ response: { header: { resultCode: '00' }, body: { totalCount: 1 } } }) };
  };
  const s = createServer();
  registerTools(s, { registry: reg, fetchImpl });
  const names = [...s.tools.keys()];
  for (const t of ['call_api', 'save_key', 'list_keys', 'save_endpoint', 'apply_guide', 'search_datasets', 'explain_error']) {
    assert.ok(names.includes(t), `도구 누락: ${t}`);
  }
  // 키 저장 후 호출
  await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'save_key', arguments: { name: 'k', key: 'plain+key/' } } });
  const res = await s.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'call_api', arguments: { url: 'http://api/x', params: { pageNo: 1 } } } });
  const out = JSON.parse(res.result.content[0].text);
  assert.equal(out.요약.ok, true);
  assert.equal(out.요약.resultCode, '00');
  assert.match(calls[0], /serviceKey=plain%2Bkey%2F/); // 디코딩 키가 인코딩돼 전송
});

test('call_api: 키 없으면 친절한 에러(isError)', async () => {
  const s = createServer();
  registerTools(s, { registry: createRegistry(tmpFile()), fetchImpl: async () => ({}) });
  const res = await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'call_api', arguments: { url: 'http://x' } } });
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /서비스 키/);
});

test('extractDatasetCards: 링크 패턴 파싱', () => {
  const html = '<a href="/data/15012345/openapi.do" class="title"> 버스 도착정보 </a><a href="/data/15067890/openapi.do"> 지하철 </a>';
  const items = extractDatasetCards(html);
  assert.equal(items.length, 2);
  assert.equal(items[0].id, '15012345');
  assert.match(items[0].link, /15012345\/openapi/);
});
