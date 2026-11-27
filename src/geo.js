// 한국 공공데이터에서 자주 만나는 좌표 형식 변환 — 순수 함수, 의존성 없음.
//   · 투영: WGS84 위경도 <-> 한국 TM (EPSG:5179 UTM-K, 5185~5188 중부원점 계열; GRS80 기준)
//   · 거리: 하버사인
//   · 문자열 파싱과 항목에서 좌표 찾기는 geo-parse.js
//   ※ 옛 Bessel 기반 TM(EPSG:5174 등)은 데이텀 변환이 필요해 지원하지 않는다.

const A = 6378137;
const F = 1 / 298.257222101;
const E2 = 2 * F - F * F;
const EP2 = E2 / (1 - E2);
const RAD = Math.PI / 180;

export const PROJECTIONS = {
  'EPSG:5179': { lat0: 38, lon0: 127.5, k0: 0.9996, fe: 1000000, fn: 2000000, name: 'UTM-K' },
  'EPSG:5185': { lat0: 38, lon0: 125, k0: 1, fe: 200000, fn: 600000, name: '서부원점(2010)' },
  'EPSG:5186': { lat0: 38, lon0: 127, k0: 1, fe: 200000, fn: 600000, name: '중부원점(2010)' },
  'EPSG:5187': { lat0: 38, lon0: 129, k0: 1, fe: 200000, fn: 600000, name: '동부원점(2010)' },
  'EPSG:5188': { lat0: 38, lon0: 131, k0: 1, fe: 200000, fn: 600000, name: '동해원점(2010)' },
};

function meridian(phi) {
  const e4 = E2 * E2; const e6 = e4 * E2;
  return A * ((1 - E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
    - (3 * E2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi)
    - (35 * e6 / 3072) * Math.sin(6 * phi));
}

function projOf(code) {
  const p = PROJECTIONS[String(code).toUpperCase()];
  if (!p) throw new Error(`지원하지 않는 좌표계: ${code} (지원: ${Object.keys(PROJECTIONS).join(', ')})`);
  return p;
}

// 위경도(도) -> TM 평면좌표(m)
export function wgs84ToTm(lat, lng, code = 'EPSG:5186') {
  const p = projOf(code);
  const phi = lat * RAD;
  const s = Math.sin(phi); const c = Math.cos(phi); const t = s / c;
  const N = A / Math.sqrt(1 - E2 * s * s);
  const T = t * t; const C = EP2 * c * c; const a = (lng - p.lon0) * RAD * c;
  const x = p.k0 * N * (a + (1 - T + C) * a ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * EP2) * a ** 5 / 120) + p.fe;
  const y = p.k0 * (meridian(phi) - meridian(p.lat0 * RAD) + N * t * (a * a / 2
    + (5 - T + 9 * C + 4 * C * C) * a ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * EP2) * a ** 6 / 720)) + p.fn;
  return { x, y };
}

// TM 평면좌표(m) -> 위경도(도)
export function tmToWgs84(x, y, code = 'EPSG:5186') {
  const p = projOf(code);
  const e4 = E2 * E2; const e6 = e4 * E2;
  const M = meridian(p.lat0 * RAD) + (y - p.fn) / p.k0;
  const mu = M / (A * (1 - E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const s = Math.sin(phi1); const c = Math.cos(phi1);
  const C1 = EP2 * c * c; const T1 = (s / c) ** 2;
  const N1 = A / Math.sqrt(1 - E2 * s * s);
  const R1 = A * (1 - E2) / (1 - E2 * s * s) ** 1.5;
  const D = (x - p.fe) / (N1 * p.k0);
  const lat = phi1 - (N1 * (s / c) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6 / 720);
  const lng = p.lon0 * RAD + (D - (1 + 2 * T1 + C1) * D ** 3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5 / 120) / c;
  return { lat: lat / RAD, lng: lng / RAD };
}

// 두 지점 사이 거리(m)
export function haversine(a, b) {
  const dLat = (b.lat - a.lat) * RAD; const dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}
