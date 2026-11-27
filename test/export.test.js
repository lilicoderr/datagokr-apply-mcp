import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { flatten, toCsv, safeFileName, writeExport } from '../src/export.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'datago-exp-'));

test('flatten: 중첩 객체는 점 표기, 배열은 JSON 문자열', () => {
  assert.deepEqual(flatten({ a: { b: 1, c: { d: 2 } }, e: [1, 2], f: 'x' }), { 'a.b': 1, 'a.c.d': 2, e: '[1,2]', f: 'x' });
});

test('toCsv: 헤더 합집합, 쉼표·따옴표·개행 이스케이프', () => {
  const csv = toCsv([{ a: 1, b: '가,나' }, { a: 2, c: 'He said "hi"' }, { a: 3, b: '줄\n바꿈' }]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'a,b,c');
  assert.equal(lines[1], '1,"가,나",');
  assert.equal(lines[2], '2,,"He said ""hi"""');
  assert.match(csv, /"줄\n바꿈"/);
});

test('toCsv: 수식 주입 방지(=,+,-,@ 로 시작하는 문자열), 음수 숫자는 유지', () => {
  const csv = toCsv([{ a: '=SUM(A1)', b: '-5', c: -5, d: '@cmd', e: '+82-10' }]);
  assert.equal(csv.split('\r\n')[1], "'=SUM(A1),-5,-5,'@cmd,'+82-10");
});

test('toCsv: 빈 배열은 헤더만(빈 줄)', () => {
  assert.equal(toCsv([]), '\r\n');
});

test('safeFileName: 경로 문자·확장자 정리', () => {
  assert.equal(safeFileName('../../etc/passwd', 'csv'), 'etc_passwd.csv');
  assert.equal(safeFileName('공휴일 2025.json', 'csv'), '공휴일_2025.csv');
  assert.equal(safeFileName('', 'json'), 'export.json');
  assert.equal(safeFileName('.hidden', 'csv'), 'hidden.csv');
});

test('writeExport: CSV 는 BOM 포함, JSON 은 들여쓰기, 폴더 안에만 생성', () => {
  const dir = tmpDir();
  const c = writeExport([{ 이름: '가' }], { format: 'csv', name: '../x', dir });
  assert.equal(path.dirname(c.file), dir);
  assert.equal(fs.readFileSync(c.file, 'utf8').charCodeAt(0), 0xFEFF);
  const j = writeExport([{ a: 1 }], { format: 'json', name: 'y', dir });
  assert.deepEqual(JSON.parse(fs.readFileSync(j.file, 'utf8')), [{ a: 1 }]);
  assert.equal(j.rows, 1);
});

test('writeExport: 지원하지 않는 형식은 오류', () => {
  assert.throws(() => writeExport([], { format: 'xml', dir: tmpDir() }), /csv/);
});

import { createServer } from '../src/mcp.js';
import { createRegistry } from '../src/registry.js';
import { registerTools } from '../src/tools.js';

function pagedFetch(pages) {
  return async (url) => {
    const n = Number(new URL(url).searchParams.get('pageNo') || 1);
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(pages[n - 1]) };
  };
}
const pg = (items, pageNo, total) => ({ response: { header: { resultCode: '00' }, body: { items: { item: items }, pageNo, numOfRows: 2, totalCount: total } } });

test('export_data: 페이지를 모아 CSV 파일로 저장하고 경로만 반환', async () => {
  const dir = tmpDir();
  const reg = createRegistry(path.join(dir, 'c.json'));
  reg.saveKey('k', 'plainkey0123456789');
  const s = createServer();
  registerTools(s, { registry: reg, exportDir: path.join(dir, 'out'), sleep: async () => {},
    fetchImpl: pagedFetch([pg([{ n: '가' }, { n: '나' }], 1, 3), pg([{ n: '다' }], 2, 3)]) });
  const res = await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'export_data', arguments: { url: 'http://x/api', numOfRows: 2, filename: '목록' } } });
  const out = JSON.parse(res.result.content[0].text);
  assert.equal(out.행수, 3);
  assert.equal(out.잘림, false);
  assert.equal(path.basename(out.저장됨), '목록.csv');
  assert.match(fs.readFileSync(out.저장됨, 'utf8'), /n\r\n가\r\n나\r\n다/);
});

test('export_data: 항목이 없으면 파일을 만들지 않음', async () => {
  const dir = tmpDir();
  const reg = createRegistry(path.join(dir, 'c.json'));
  reg.saveKey('k', 'plainkey0123456789');
  const s = createServer();
  registerTools(s, { registry: reg, exportDir: path.join(dir, 'out'), sleep: async () => {}, fetchImpl: pagedFetch([pg([], 1, 0)]) });
  const res = await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'export_data', arguments: { url: 'http://x' } } });
  assert.match(res.result.content[0].text, /저장할 항목이 없어요/);
  assert.equal(fs.existsSync(path.join(dir, 'out')), false);
});
