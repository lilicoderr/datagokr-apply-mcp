import test from 'node:test';
import assert from 'node:assert/strict';
import { wgs84ToTm, tmToWgs84, haversine, PROJECTIONS } from '../src/geo.js';
import { parseCoordinate, findLatLng } from '../src/geo-parse.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

test('투영 원점은 false easting/northing 으로 간다', () => {
  for (const [code, p] of Object.entries(PROJECTIONS)) {
    const r = wgs84ToTm(p.lat0, p.lon0, code);
    near(r.x, p.fe, 1e-6, code); near(r.y, p.fn, 1e-6, code);
  }
});

test('왕복 변환 오차 < 10cm (서울·부산·제주·독도)', () => {
  const pts = [[37.5665, 126.978], [35.1796, 129.0756], [33.4996, 126.5312], [37.2418, 131.8647]];
  for (const code of Object.keys(PROJECTIONS)) {
    for (const [lat, lng] of pts) {
      if (Math.abs(lng - PROJECTIONS[code].lon0) > 4) continue; // 원점에서 멀면 급수 전개 오차가 커짐(적용 범위 밖)
      const { x, y } = wgs84ToTm(lat, lng, code);
      const b = tmToWgs84(x, y, code);
      near(b.lat, lat, 1e-6, `${code} lat`); near(b.lng, lng, 1e-6, `${code} lng`);
    }
  }
});

test('UTM-K 서울시청 부근 값이 알려진 범위에 있다 / 미지원 좌표계는 오류', () => {
  const { x, y } = wgs84ToTm(37.5665, 126.978, 'EPSG:5179');
  near(x, 953950, 300); near(y, 1952050, 300);
  assert.throws(() => wgs84ToTm(37, 127, 'EPSG:5174'), /지원하지 않는/);
});

test('하버사인: 서울-부산 약 325km', () => {
  near(haversine({ lat: 37.5665, lng: 126.978 }, { lat: 35.1796, lng: 129.0756 }) / 1000, 325, 5);
  assert.equal(haversine({ lat: 1, lng: 1 }, { lat: 1, lng: 1 }), 0);
});

test('parseCoordinate: 십진/도분초/반구문자/뒤바뀜', () => {
  assert.deepEqual(parseCoordinate('37.5665, 126.978'), { lat: 37.5665, lng: 126.978 });
  assert.deepEqual(parseCoordinate('126.978, 37.5665'), { lat: 37.5665, lng: 126.978, swapped: true });
  assert.deepEqual(parseCoordinate('(37.5665 126.978)'), { lat: 37.5665, lng: 126.978 });
  const d = parseCoordinate('37°33\'59.4"N 126°58\'40.8"E');
  near(d.lat, 37.5665, 1e-4); near(d.lng, 126.978, 1e-4);
  const n = parseCoordinate('N37 33 59.4 E126 58 40.8');
  near(n.lat, 37.5665, 1e-4); near(n.lng, 126.978, 1e-4);
  assert.deepEqual(parseCoordinate('E126.978 N37.5665'), { lat: 37.5665, lng: 126.978, swapped: true });
  assert.equal(parseCoordinate('33.8S, 151.2E').lat, -33.8);
  for (const bad of ['', null, 'abc', '1,2,3', '95, 200', '37.5']) assert.equal(parseCoordinate(bad), null, String(bad));
});

test('findLatLng: 키 이름 변형과 TM 좌표', () => {
  assert.deepEqual(findLatLng({ 위도: '37.5', 경도: '127.0' }), { lat: 37.5, lng: 127, source: 'latlng' });
  assert.deepEqual(findLatLng({ mapx: '126.9', mapy: '37.6' }), { lat: 37.6, lng: 126.9, source: 'latlng' });
  assert.deepEqual(findLatLng({ LAT: 127, LNG: 37.5 }), { lat: 37.5, lng: 127, source: 'latlng' });
  const { x, y } = wgs84ToTm(37.5665, 126.978, 'EPSG:5186');
  const r = findLatLng({ XCOORD: x, YCOORD: y });
  near(r.lat, 37.5665, 1e-6); assert.equal(r.source, 'tm:EPSG:5186');
  assert.equal(findLatLng({ name: 'x' }), null);
  assert.equal(findLatLng({ lat: '', lng: '' }), null);
  assert.equal(findLatLng(null), null);
});
