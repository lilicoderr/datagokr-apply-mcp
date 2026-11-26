import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXml, findFirst } from '../src/xml.js';

test('기본 중첩 요소', () => {
  const r = parseXml('<response><header><resultCode>00</resultCode><resultMsg>NORMAL</resultMsg></header></response>');
  assert.equal(r.response.header.resultCode, '00');
  assert.equal(r.response.header.resultMsg, 'NORMAL');
});

test('반복 요소는 배열로', () => {
  const r = parseXml('<items><item>a</item><item>b</item><item>c</item></items>');
  assert.deepEqual(r.items.item, ['a', 'b', 'c']);
});

test('CDATA 와 엔티티', () => {
  const r = parseXml('<r><t><![CDATA[<b>굵게</b>]]></t><u>a &amp; b &lt; c</u></r>');
  assert.equal(r.r.t, '<b>굵게</b>');
  assert.equal(r.r.u, 'a & b < c');
});

test('속성은 @ 로, 자기닫는 태그', () => {
  const r = parseXml('<a><b id="1" type="x">hi</b><c/></a>');
  assert.equal(r.a.b['@id'], '1');
  assert.equal(r.a.b['#text'], 'hi');
  assert.equal(r.a.c, '');
});

test('XML 선언/주석 무시', () => {
  const r = parseXml('<?xml version="1.0" encoding="UTF-8"?><!-- 주석 --><root><v>1</v></root>');
  assert.equal(r.root.v, '1');
});

test('findFirst: 깊은 곳의 키', () => {
  const r = parseXml('<response><body><items><item><cmmMsgHeader><returnReasonCode>30</returnReasonCode></cmmMsgHeader></item></items></body></response>');
  assert.equal(findFirst(r, ['resultCode', 'returnReasonCode']), '30');
  assert.equal(findFirst(r, ['없는키']), null);
});

test('실제형: 공공데이터 표준 응답', () => {
  const xml = `<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
    <body><items>
      <item><title>가</title><cnt>10</cnt></item>
      <item><title>나</title><cnt>20</cnt></item>
    </items><numOfRows>10</numOfRows><totalCount>2</totalCount></body></response>`;
  const r = parseXml(xml);
  assert.equal(r.response.body.totalCount, '2');
  assert.equal(r.response.body.items.item.length, 2);
  assert.equal(r.response.body.items.item[1].title, '나');
});

test('숫자 문자 참조(10진/16진)를 한글 포함해 디코딩', () => {
  assert.deepEqual(parseXml('<r><a>&#65;&#x42;&#xAC00;&#44032;</a></r>'), { r: { a: 'AB가가' } });
});

test('이중 디코딩 방지: &amp;lt; 는 &lt; 로', () => {
  assert.equal(parseXml('<r><a>&amp;lt;b&amp;gt;</a></r>').r.a, '&lt;b&gt;');
  assert.equal(parseXml('<r><a>&lt;b&gt; &amp; &quot;x&quot; &apos;y&apos;</a></r>').r.a, '<b> & "x" \'y\'');
});

test('잘못된 숫자 참조는 원문 유지', () => {
  assert.equal(parseXml('<r><a>&#x110000;</a></r>').r.a, '&#x110000;');
});

test('네임스페이스 접두사·속성 보존, BOM/DOCTYPE 무시', () => {
  const x = parseXml('﻿<!DOCTYPE a><soap:Env xmlns:soap="u"><soap:Body><v>1</v></soap:Body></soap:Env>');
  assert.equal(x['soap:Env']['@xmlns:soap'], 'u');
  assert.equal(x['soap:Env']['soap:Body'].v, '1');
});
