// 좌표 문자열 파싱과 API 결과 항목에서 좌표 필드 찾기 (순수 함수).
import { tmToWgs84 } from './geo.js';

const inKorea = (lat, lng) => lat >= 33 && lat <= 39.5 && lng >= 124 && lng <= 132.5;
export const isValidLatLng = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

// 도분초 한 덩어리 (37°33'59.7"N, N37 33 59.7, 37.5665) 를 십진도로. 못 읽으면 null.
const ONE = /^\s*([NSEWnsew])?\s*(-?\d+(?:\.\d+)?)\s*(?:[°d\s]\s*(\d+(?:\.\d+)?)\s*(?:['′m\s]\s*(\d+(?:\.\d+)?)\s*(?:["″s]|'')?)?)?\s*([NSEWnsew])?\s*$/;
function parseOne(s) {
  const m = ONE.exec(s);
  if (!m) return null;
  const hemi = (m[1] || m[5] || '').toUpperCase();
  const deg = Number(m[2]);
  let v = Math.abs(deg) + (m[3] ? Number(m[3]) / 60 : 0) + (m[4] ? Number(m[4]) / 3600 : 0);
  if (deg < 0 || hemi === 'S' || hemi === 'W') v = -v;
  return { v, hemi };
}

function splitTwo(str) {
  let parts = str.split(/\s*[,;]\s*/);
  if (parts.length === 2) return parts;
  parts = str.split(/\s*[\/|]\s*/);
  if (parts.length === 2) return parts;
  const dms = str.split(/(?<=["″'′NSEWnsew])\s+(?=[NSEWnsew]?\s*-?\d)/);
  if (dms.length === 2) return dms;
  const pre = str.split(/\s+(?=[NSEWnsew]\s*\d)/); // N37 33 59.4 E126 58 40.8
  if (pre.length === 2) return pre;
  const t = str.split(/\s+/);
  return t.length === 2 ? t : null;
}

function finish(lat, lng, swapped) {
  if (!isValidLatLng(lat, lng)) return null;
  return { lat, lng, ...(swapped ? { swapped: true } : {}) };
}

// "37.5665, 126.978" / "126.978 37.5665" / 도분초 -> { lat, lng, swapped? }.
// 반구 문자(N/E)나 한국 범위로 위경도가 뒤바뀐 것을 바로잡는다. 읽을 수 없으면 null.
export function parseCoordinate(input) {
  const str = String(input ?? '').trim().replace(/[()[\]]/g, '');
  const parts = str ? splitTwo(str) : null;
  if (!parts) return null;
  const a = parseOne(parts[0]); const b = parseOne(parts[1]);
  if (!a || !b) return null;
  const firstIsLng = a.hemi === 'E' || a.hemi === 'W';
  const secondIsLat = b.hemi === 'N' || b.hemi === 'S';
  if (firstIsLng || secondIsLat || (!inKorea(a.v, b.v) && inKorea(b.v, a.v))) return finish(b.v, a.v, true);
  return finish(a.v, b.v, false);
}

const LAT_KEYS = ['lat', 'latitude', 'mapy', 'ypos', 'gpslati', '위도', 'la', 'y좌표', 'lat_wgs84'];
const LNG_KEYS = ['lng', 'lon', 'long', 'longitude', 'mapx', 'xpos', 'gpslong', '경도', 'lo', 'x좌표', 'lng_wgs84'];
const norm = (k) => String(k).toLowerCase().replace(/[\s_-]/g, '');

// 항목(객체)에서 위경도를 찾는다. 위경도 키가 없고 x/y 가 한국 TM 범위로 보이면 tm 좌표계로 변환한다.
export function findLatLng(item, { tm = 'EPSG:5186' } = {}) {
  if (!item || typeof item !== 'object') return null;
  const byKey = new Map(Object.keys(item).map((k) => [norm(k), item[k]]));
  const pick = (keys) => {
    for (const k of keys) {
      const v = byKey.get(norm(k));
      if (v !== undefined && v !== '' && v !== null) return Number(v);
    }
    return NaN;
  };
  let lat = pick(LAT_KEYS); let lng = pick(LNG_KEYS);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    if (!inKorea(lat, lng) && inKorea(lng, lat)) [lat, lng] = [lng, lat]; // 위경도 뒤바뀜 보정
  }
  if (isValidLatLng(lat, lng)) {
    return { lat, lng, source: 'latlng' };
  }
  const x = pick(['x', 'xcoord', 'coordx', 'tmx']); const y = pick(['y', 'ycoord', 'coordy', 'tmy']);
  if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) > 1000 && Math.abs(y) > 1000) {
    const p = tmToWgs84(x, y, tm);
    if (inKorea(p.lat, p.lng)) return { ...p, source: `tm:${tm}` };
  }
  return null;
}
