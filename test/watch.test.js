import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/mcp.js';
import { fingerprint, diffFingerprints, createWatchStore } from '../src/watch.js';
import { registerWatchTools } from '../src/tools-watch.js';
import { parseOpenApiPage } from '../src/portal.js';
import { annotationsFor } from '../src/annotations.js';

const html = fs.readFileSync(new URL('./fixtures/openapi-detail.html', import.meta.url), 'utf8');
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'watch-')), 'w.json');
const spec = (over = {}) => ({ ...parseOpenApiPage(html), ...over });

test('fingerprint: 순서·활용신청 수 변동에는 둔감, 실제 변경에는 민감', () => {
  const a = fingerprint(spec());
  assert.equal(fingerprint(spec({ applications: '99999', request: [...spec().request].reverse() })).hash, a.hash);
  assert.notEqual(fingerprint(spec({ endpoint: 'https://apis.data.go.kr/new' })).hash, a.hash);
  assert.notEqual(fingerprint(spec({ updated: '2026-01-01' })).hash, a.hash);
});

test('diffFingerprints: 스칼라와 목록 차이', () => {
  const a = fingerprint(spec());
  const b = fingerprint(spec({ title: '새 제목', response: [...spec().response, { name: 'newField' }] }));
  const d = diffFingerprints(a, b);
  assert.deepEqual(d.find((x) => x.field === 'title'), { field: 'title', from: '한국천문연구원_특일 정보', to: '새 제목' });
  assert.deepEqual(d.find((x) => x.field === 'response').added, ['newField']);
  assert.deepEqual(diffFingerprints(a, a), []);
});

test('store: 첫 확인은 기준선, 이후 변경 감지, remove/list', () => {
  const file = tmp();
  let t = 0;
  const s = createWatchStore(file, { now: () => new Date(Date.UTC(2026, 0, 1, 0, t++)) });
  const r1 = s.check('15012690', spec());
  assert.equal(r1.baseline, true); assert.equal(r1.changed, false);
  assert.equal(s.check('15012690', spec()).changed, false);
  const r3 = s.check('15012690', spec({ traffic: '변경됨' }));
  assert.equal(r3.changed, true);
  assert.equal(r3.changes[0].field, 'traffic');
  assert.equal(s.list()[0].changedAt, r3.checkedAt);
  assert.equal(s.remove('15012690'), true);
  assert.equal(s.remove('15012690'), false);
  assert.deepEqual(s.list(), []);
});

test('스냅샷 파일에는 명세 메타데이터만 있고 비밀 형태 값이 없다', () => {
  const file = tmp();
  createWatchStore(file).check('15012690', spec());
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!/serviceKey|cookie|storageState|password/i.test(raw));
  assert.deepEqual(Object.keys(JSON.parse(raw).datasets['15012690']).sort(), ['changedAt', 'checkedAt', 'fields', 'hash', 'title']);
});

test('dataset_watch 도구: check → 변경 → list → remove', async () => {
  const s = createServer({});
  let page = html;
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => page });
  registerWatchTools(s, { fetchImpl, store: createWatchStore(tmp()) });
  const call = async (args) => JSON.parse((await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'dataset_watch', arguments: args } })).result.content[0].text);
  const first = await call({ ids: ['15012690', 'https://www.data.go.kr/data/15012690/openapi.do'] });
  assert.equal(first.확인, 1); assert.equal(first.기준선저장, 1);
  page = html.replace('getAnniversaryInfo', 'getAnniversaryInfo2');
  const second = await call({ action: 'check', ids: ['15012690'] });
  assert.equal(second.변경됨, 1);
  assert.equal((await call({ action: 'list' })).감시중.length, 1);
  assert.equal((await call({ action: 'remove', ids: ['15012690'] })).해제[0].있었음, true);
  const bad = await s.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'dataset_watch', arguments: { ids: ['abc'] } } });
  assert.equal(bad.result.isError, true);
  assert.equal(annotationsFor('dataset_watch').readOnlyHint, false);
});
