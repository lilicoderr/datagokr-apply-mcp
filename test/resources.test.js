import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/mcp.js';
import { createRegistry } from '../src/registry.js';
import { registerResources } from '../src/resources.js';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'res-'));
  const registry = createRegistry(path.join(dir, 'c.json'));
  registry.saveKey('main', 'ABCDEFGH12345678SECRETSECRET9999');
  const server = createServer({ name: 't' });
  registerResources(server, { registry });
  return server;
}
const rpc = (s, method, params) => s.handle({ jsonrpc: '2.0', id: 1, method, params });

test('initialize advertises resources and prompts', async () => {
  const r = await rpc(setup(), 'initialize', { protocolVersion: '2025-06-18' });
  assert.ok(r.result.capabilities.resources);
  assert.ok(r.result.capabilities.prompts);
});

test('keys resource is masked', async () => {
  const s = setup();
  const list = await rpc(s, 'resources/list');
  assert.ok(list.result.resources.some((x) => x.uri === 'datago://keys'));
  const r = await rpc(s, 'resources/read', { uri: 'datago://keys' });
  assert.ok(!r.result.contents[0].text.includes('SECRETSECRET'));
  assert.match(r.result.contents[0].text, /main/);
});

test('unknown resource errors', async () => {
  const r = await rpc(setup(), 'resources/read', { uri: 'datago://nope' });
  assert.equal(r.error.code, -32002);
});

test('find-and-call-api prompt', async () => {
  const s = setup();
  const r = await rpc(s, 'prompts/get', { name: 'find-and-call-api', arguments: { topic: '미세먼지' } });
  assert.match(r.result.messages[0].content.text, /미세먼지/);
  const bad = await rpc(s, 'prompts/get', { name: 'find-and-call-api', arguments: {} });
  assert.ok(bad.error);
});
