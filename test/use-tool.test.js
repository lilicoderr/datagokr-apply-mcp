// use_api 도구 껍데기: 진행률, 취소(이어 하기), confirm 엄격성, 동시 실행 방지, 오류 입력
process.env.DATAGO_ALLOW_LOCAL = '1';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/mcp.js';
import { registerUseTool } from '../src/tools-use.js';
import { setup, ENC, DEC } from './helpers/use-mocks.js';

const call = (args, token, id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/call',
  params: { name: 'use_api', arguments: args, ...(token ? { _meta: { progressToken: token } } : {}) } });
const server = (s) => { const srv = createServer({}); registerUseTool(srv, s.deps); return srv; };

test('use_api: 진행률 알림(단조 증가)과 구조화 결과, 키 원문 없음', async () => {
  const s = setup(); s.world.code = '00';
  const got = [];
  const res = await server(s).handle(call({ idOrUrl: '15000001', confirm: true }, 'p'), { notify: (n) => got.push(n.params.progress) });
  assert.equal(res.result.structuredContent.status, 'ready');
  assert.ok(got.length >= 2 && got.every((v, i) => i === 0 || v > got[i - 1]), got.join());
  const text = JSON.stringify(res.result);
  assert.ok(!text.includes(ENC) && !text.includes(DEC));
  assert.match(res.result.content[0].text, /curl -G/);
});

test('use_api: confirm 은 정확히 true 일 때만 (문자열 "true" 는 제출 안 함)', async () => {
  const s = setup();
  const res = await server(s).handle(call({ idOrUrl: '15000001', confirm: 'true' }));
  assert.equal(res.result.structuredContent.status, 'needs_confirm');
  assert.equal(s.world.applied.length, 0);
});

test('use_api: 잘못된 입력은 isError, 같은 id 동시 실행은 busy', async () => {
  const s = setup();
  const srv = server(s);
  assert.equal((await srv.handle(call({ idOrUrl: 'abc' }))).result.isError, true);
  let release;
  s.apply.checkLogin = () => new Promise((r) => { release = () => r({ loggedIn: true }); });
  const first = srv.handle(call({ idOrUrl: '15000001', confirm: true }, undefined, 1));
  await new Promise((r) => setTimeout(r, 20));
  const second = await srv.handle(call({ idOrUrl: '15000001', confirm: true }, undefined, 2));
  assert.equal(second.result.structuredContent.status, 'busy');
  release(); await first;
  assert.equal(s.world.applied.length, 1);
});

test('use_api: 신청 도중 취소해도 제출 기록은 남고 다시 실행하면 재신청 없이 이어진다', async () => {
  const s = setup(); s.world.code = '00';
  const srv = server(s);
  const origApply = s.apply.applyForApis;
  s.apply.applyForApis = async (...a) => {
    const r = await origApply(...a);
    await srv.handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } });
    return r;
  };
  const res = await srv.handle(call({ idOrUrl: '15000001', confirm: true }, undefined, 1));
  assert.equal(res, null); // 취소된 요청에는 응답하지 않음
  assert.ok(s.registry.getFlow('15000001')?.appliedAt);
  await new Promise((r) => setTimeout(r, 20));
  const again = await srv.handle(call({ idOrUrl: '15000001' }, undefined, 2));
  assert.equal(again.result.structuredContent.status, 'ready', again.result.content[0].text);
  assert.equal(s.world.applied.length, 1);
});
