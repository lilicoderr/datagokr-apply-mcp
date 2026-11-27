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

import { validateServiceKeys } from '../src/keyextract.js';

const DEC = 'FAKEFAKEFAKEfakeKEY+EXAMPLE/NOTAREALKEY0123456789abcdefghij==';
const ENC = encodeURIComponent(DEC);

test('extractServiceKeys: 무관한 문장 속 "Encoding" 을 건너뛰고 짝이 맞는 진짜 키를 고른다', () => {
  const page = `<p>일반 인증키 안내: Encoding 방식은 UTF8 입니다. Encoding: THIS-IS-JUST-SOME-UNRELATED-LONG-WORD</p>
    <div>Encoding ${ENC}</div><div>Decoding ${DEC}</div>`;
  const k = extractServiceKeys(page);
  assert.equal(k.encoding, ENC);
  assert.equal(k.decoding, DEC);
  assert.equal(validateServiceKeys(k).ok, true);
});

test('extractServiceKeys: Decoding 만 있는 페이지도 검증을 통과', () => {
  const k = extractServiceKeys(`<div>일반 인증키 Decoding <input value="${DEC}"></div>`);
  assert.equal(k.decoding, DEC);
  assert.equal(k.encoding, ENC);
  assert.equal(validateServiceKeys(k).ok, true);
});

test('validateServiceKeys: 짧거나 틀린 토큰은 거부', () => {
  const short = extractServiceKeys('<div>일반 인증키 Encoding: FAKEFAKEFAKEfakeKEY%2BEXAMPLE%2FNOTAREAL</div>');
  assert.equal(validateServiceKeys(short).ok, false);
  assert.match(validateServiceKeys(short).reason, /길이/);
  assert.equal(validateServiceKeys({ encoding: ENC, decoding: DEC + 'x' }).ok, false);
  assert.equal(validateServiceKeys({ encoding: 'a'.repeat(300), decoding: 'a'.repeat(300) }).ok, false);
  assert.equal(validateServiceKeys({ encoding: '%E0%A4%A', decoding: DEC }).ok, false);
  assert.equal(validateServiceKeys(null).ok, false);
});
