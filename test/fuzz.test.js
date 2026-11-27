// 응답 파서 퍼즈 테스트 — 시드 고정 PRNG 로 재현 가능. 어떤 입력에도 예외·무한대기·프로토타입 오염이 없어야 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/datago.js';
import { parseXml, findFirst } from '../src/xml.js';
import { extractItems, hasMore } from '../src/items.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

const XML_ATOMS = ['<', '>', '</', '/>', '<?xml version="1.0"?>', '<!--', '-->', '<![CDATA[', ']]>', '<!DOCTYPE x [<!ENTITY a "b">]>',
  '&amp;', '&lt;', '&#x1F600;', '&#99999999;', '&bogus;', '&', '"', "'", '=', ' ', '\n', '\u0000', '﻿', '한글', 'a', 'item', 'response',
  '<item>', '</item>', '<resultCode>', '</resultCode>', '<a b="c">', '<__proto__>', '<constructor>', '</__proto__>', 'x:y', '<ns:a xmlns:ns="u">'];
const JSON_ATOMS = ['{', '}', '[', ']', ',', ':', '"', '"a"', 'null', 'true', '-1e999', '0.1', '\\u00', '\\', '"__proto__"', '"items"', '"item"',
  '{"response":{"body":{"items":{"item":[{"a":1}]}}}}', '\n', ' ', '한글', '"resultCode":"00"'];

function junk(r, atoms, n) { let s = ''; for (let i = 0; i < n; i++) s += pick(r, atoms); return s; }
function mutate(r, base) {
  let s = base;
  for (let i = 0; i < 1 + Math.floor(r() * 4); i++) {
    const at = Math.floor(r() * (s.length + 1));
    const op = Math.floor(r() * 3);
    if (op === 0) s = s.slice(0, at) + s.slice(at + 1 + Math.floor(r() * 5));
    else if (op === 1) s = s.slice(0, at) + pick(r, XML_ATOMS) + s.slice(at);
    else s = s.slice(0, at);
  }
  return s;
}

const VALID_XML = '<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>00</resultCode><resultMsg>OK</resultMsg></header>'
  + '<body><items><item><a>1</a><b x="y">한글 &amp; 2</b></item><item><a>3</a></item></items><totalCount>2</totalCount></body></response>';
const VALID_JSON = '{"response":{"header":{"resultCode":"00"},"body":{"items":{"item":[{"a":1},{"a":2}]},"totalCount":2}}}';

function never_throws(input, ct) {
  const t0 = performance.now();
  const r = interpret(input, ct);
  const ms = performance.now() - t0;
  assert.ok(ms < 500, `너무 느림 ${ms.toFixed(0)}ms: ${JSON.stringify(input).slice(0, 80)}`);
  assert.ok(['json', 'xml', 'text'].includes(r.kind));
  const ex = extractItems(r.data);
  assert.ok(Array.isArray(ex.items));
  hasMore({ ...ex, pageNo: 1, numOfRows: 10 });
  findFirst(r.data, ['resultCode']);
  return r;
}

test('fuzz: 무작위 조각 XML/JSON 에서 interpret/extractItems 가 던지지 않는다 (3000건)', () => {
  const r = rng(12345);
  for (let i = 0; i < 3000; i++) {
    never_throws(junk(r, XML_ATOMS, Math.floor(r() * 30)), 'application/xml');
    never_throws(junk(r, JSON_ATOMS, Math.floor(r() * 30)), 'application/json');
    never_throws(junk(r, XML_ATOMS, Math.floor(r() * 12)), '');
  }
});

test('fuzz: 유효 문서를 변형(삭제/삽입/절단)해도 던지지 않고, 원본은 여전히 해석된다', () => {
  const r = rng(777);
  for (let i = 0; i < 1500; i++) {
    never_throws(mutate(r, VALID_XML), 'text/xml');
    never_throws(mutate(r, VALID_JSON), 'application/json');
  }
  assert.equal(interpret(VALID_XML, 'text/xml').resultCode, '00');
  assert.equal(extractItems(interpret(VALID_JSON, 'application/json').data).items.length, 2);
});

test('fuzz: 깊은 중첩·긴 입력에서도 빠르게 끝난다 (ReDoS/스택 보호)', () => {
  const deep = '<a>'.repeat(5000) + 'x' + '</a>'.repeat(5000);
  never_throws(deep, 'xml');
  never_throws('['.repeat(5000) + ']'.repeat(5000), 'application/json');
  never_throws('<a b="' + '&'.repeat(200000) + '"/>', 'xml');
  never_throws('<!--' + '-'.repeat(200000), 'xml');
  never_throws('<![CDATA[' + 'x]'.repeat(100000), 'xml');
  never_throws('<' + 'a'.repeat(200000), 'xml');
  never_throws(`<r>${'<i>1</i>'.repeat(20000)}</r>`, 'xml');
});

test('보안: __proto__/constructor 태그와 키가 Object.prototype 을 오염시키지 않는다', () => {
  never_throws('<r><__proto__><polluted>yes</polluted></__proto__><constructor><prototype><p2>1</p2></prototype></constructor></r>', 'xml');
  never_throws('{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"p2":1}}}', 'application/json');
  assert.equal({}.polluted, undefined);
  assert.equal({}.p2, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test('parseXml 은 실패해도 항상 Error 인스턴스만 던진다', () => {
  const r = rng(99);
  for (let i = 0; i < 2000; i++) {
    try { parseXml(junk(r, XML_ATOMS, Math.floor(r() * 25))); } catch (e) { assert.ok(e instanceof Error, String(e)); }
  }
});
