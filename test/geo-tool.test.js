import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/mcp.js';
import { geoAction, registerGeoTools } from '../src/tools-geo.js';
import { normalizeSido, splitAddress } from '../src/address.js';
import { annotationsFor } from '../src/annotations.js';

test('normalizeSido: 약칭/구명칭/정식', () => {
  assert.equal(normalizeSido('서울'), '서울특별시');
  assert.equal(normalizeSido('서울시'), '서울특별시');
  assert.equal(normalizeSido('경기'), '경기도');
  assert.equal(normalizeSido('전라북도'), '전북특별자치도');
  assert.equal(normalizeSido('충청남도'), '충청남도');
  assert.equal(normalizeSido('제주도'), '제주특별자치도');
  assert.equal(normalizeSido('화성'), null);
  assert.equal(normalizeSido(''), null);
});

test('splitAddress: 시도·시군구·나머지', () => {
  assert.deepEqual(splitAddress('서울 강남구 테헤란로 152'), { sido: '서울특별시', sigungu: '강남구', rest: '테헤란로 152' });
  assert.deepEqual(splitAddress('경기도 수원시 영통구 광교로 1'), { sido: '경기도', sigungu: '수원시 영통구', rest: '광교로 1' });
  assert.deepEqual(splitAddress('세종 한누리대로 2130'), { sido: '세종특별자치시', sigungu: null, rest: '한누리대로 2130' });
  assert.deepEqual(splitAddress('테헤란로 152'), { sido: null, sigungu: null, rest: '테헤란로 152' });
  assert.deepEqual(splitAddress(''), { sido: null, sigungu: null, rest: '' });
});

test('geoAction: to_tm → from_tm 왕복, distance, parse, enrich', () => {
  const t = geoAction({ action: 'to_tm', lat: 37.5665, lng: 126.978, tm: 'EPSG:5179' });
  assert.equal(t.crs, 'EPSG:5179');
  const b = geoAction({ action: 'from_tm', x: t.x, y: t.y, tm: 'EPSG:5179' });
  assert.ok(Math.abs(b.lat - 37.5665) < 1e-6 && Math.abs(b.lng - 126.978) < 1e-6);
  const d = geoAction({ action: 'distance', from: '37.5665,126.978', to: '35.1796,129.0756' });
  assert.ok(d.km > 320 && d.km < 330);
  assert.equal(geoAction({ action: 'parse', text: '126.978, 37.5665' }).swapped, true);
  const e = geoAction({ action: 'enrich', items: [{ 위도: '37.5', 경도: '127' }, { name: 'x' }] });
  assert.equal(e.좌표추가, 1);
  assert.deepEqual(e.항목[0]._geo, { lat: 37.5, lng: 127, source: 'latlng' });
  assert.equal(e.항목[1]._geo, undefined);
  assert.throws(() => geoAction({ action: 'nope' }), /action/);
  assert.throws(() => geoAction({ action: 'parse', text: 'zzz' }), /읽지 못/);
  assert.throws(() => geoAction({ action: 'to_tm' }), /lat/);
});

test('geo 도구는 MCP 로 호출되고 오류는 isError 로 전달된다', async () => {
  const s = createServer({});
  registerGeoTools(s);
  const ok = await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'geo', arguments: { action: 'address', text: '부산 해운대구 해운대로 1' } } });
  assert.equal(JSON.parse(ok.result.content[0].text).sigungu, '해운대구');
  const bad = await s.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'geo', arguments: { action: 'x' } } });
  assert.equal(bad.result.isError, true);
  assert.equal(annotationsFor('geo').readOnlyHint, true);
});
