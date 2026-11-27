import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractServiceKeys, maskSecret } from '../src/keyextract.js';

const html = fs.readFileSync(new URL('./fixtures/devaccount.html', import.meta.url), 'utf8');

test('extractServiceKeys: Encoding/Decoding 모두 추출 (가짜 키 픽스처)', () => {
  const k = extractServiceKeys(html);
  assert.equal(k.encoding, 'FAKEFAKEFAKEfakeKEY%2BEXAMPLE%2FNOTAREALKEY%3D%3D');
  assert.equal(k.decoding, 'FAKEFAKEFAKEfakeKEY+EXAMPLE/NOTAREALKEY==');
});

test('extractServiceKeys: 한쪽만 있어도 나머지를 계산', () => {
  const k = extractServiceKeys('<div>일반 인증키 Encoding: FAKEFAKEFAKEfakeKEY%2BEXAMPLE%2FNOTAREAL</div>');
  assert.equal(k.decoding, 'FAKEFAKEFAKEfakeKEY+EXAMPLE/NOTAREAL');
});

test('extractServiceKeys: 키가 없으면 null', () => {
  assert.equal(extractServiceKeys('<p>활용신청 현황 0</p>'), null);
  assert.equal(extractServiceKeys(''), null);
});

test('maskSecret: 원문을 노출하지 않음', () => {
  const m = maskSecret('FAKEFAKEFAKEfakeKEY+EXAMPLE/NOTAREALKEY==');
  assert.ok(!m.includes('EXAMPLE'));
  assert.equal(maskSecret('abc'), '****');
});
