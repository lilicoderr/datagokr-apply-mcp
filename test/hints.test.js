import test from 'node:test';
import assert from 'node:assert/strict';
import { inferType, pascal, toTypeScript } from '../src/hints.js';

test('inferType: 샘플 숫자 → number, 앞자리 0 은 문자열, 이름 휴리스틱', () => {
  assert.equal(inferType('pageNo', '1'), 'number');
  assert.equal(inferType('zip', '01234'), 'string');
  assert.equal(inferType('totalCnt', ''), 'number');
  assert.equal(inferType('name', '홍길동'), 'string');
  assert.equal(inferType('lat', '37.5'), 'number');
});

test('pascal: 한글/특수문자/숫자 시작 처리', () => {
  assert.equal(pascal('get bus arrival'), 'GetBusArrival');
  assert.equal(pascal('한국천문연구원 특일 정보'), '한국천문연구원특일정보');
  assert.equal(pascal('15012690'), 'Api15012690');
  assert.equal(pascal('--'), 'Api');
});

const spec = {
  title: 'Spcde Info',
  request: [
    { name: 'serviceKey', ko: '인증키', required: true, sample: '' },
    { name: 'solYear', ko: '연', required: true, sample: '2025', desc: '조회 연도' },
    { name: 'numOfRows', ko: '한 페이지 결과 수', required: false, sample: '10' },
    { name: 'weird-name', ko: '특이', required: false, sample: 'a*/b' },
  ],
  response: [{ name: 'dateName', ko: '명칭' }, { name: 'locdate', ko: '날짜', sample: '20250101' }, { name: 'isHoliday', ko: '공휴일 여부' }],
};

test('toTypeScript: Params/Item/Response 인터페이스 생성', () => {
  const ts = toTypeScript(spec);
  assert.match(ts, /export interface SpcdeInfoParams \{/);
  assert.match(ts, /solYear: number;/);
  assert.match(ts, /numOfRows\?: number;/);
  assert.match(ts, /"weird-name"\?: string;/);
  assert.match(ts, /export interface SpcdeInfoItem \{/);
  assert.match(ts, /dateName\?: string;/);
  assert.match(ts, /export interface SpcdeInfoResponse \{/);
  assert.equal((ts.match(/serviceKey\?: string;/g) || []).length, 1);
  assert.ok(!/serviceKey: /.test(ts));
});

test('toTypeScript: 주석 종료 문자열 이스케이프, 빈 명세도 유효', () => {
  const ts = toTypeScript({ title: 'x', request: [{ name: 'a', ko: 'bad */ comment', required: true }], response: [] });
  assert.ok(!ts.includes('bad */ comment'));
  assert.match(toTypeScript({ title: 'y' }), /export interface YItem \{\n\}/);
});

test('toTypeScript: name 옵션이 제목보다 우선', () => {
  assert.match(toTypeScript(spec, { name: 'holiday' }), /interface HolidayParams/);
});
