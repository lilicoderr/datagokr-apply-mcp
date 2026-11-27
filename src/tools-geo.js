// geo 도구 — 좌표/주소 형식 변환 (순수 계산, 네트워크 없음).
import { wgs84ToTm, tmToWgs84, haversine, PROJECTIONS } from './geo.js';
import { parseCoordinate, findLatLng, isValidLatLng } from './geo-parse.js';
import { splitAddress } from './address.js';

const out = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

export function geoAction(a = {}) {
  const tm = a.tm || 'EPSG:5186';
  switch (a.action) {
    case 'parse': {
      const p = parseCoordinate(a.text);
      if (!p) throw new Error('좌표를 읽지 못했어요. 예: "37.5665, 126.978" 또는 37°33\'59"N 126°58\'41"E');
      return p;
    }
    case 'to_tm': {
      if (!isValidLatLng(Number(a.lat), Number(a.lng))) throw new Error('lat, lng 가 필요합니다.');
      const r = wgs84ToTm(Number(a.lat), Number(a.lng), tm);
      return { x: round(r.x, 2), y: round(r.y, 2), crs: tm };
    }
    case 'from_tm': {
      if (!Number.isFinite(Number(a.x)) || !Number.isFinite(Number(a.y))) throw new Error('x, y 가 필요합니다.');
      const r = tmToWgs84(Number(a.x), Number(a.y), tm);
      return { lat: round(r.lat, 7), lng: round(r.lng, 7), crs: tm };
    }
    case 'distance': {
      const p = parseCoordinate(a.from); const q = parseCoordinate(a.to);
      if (!p || !q) throw new Error('from, to 좌표를 읽지 못했어요.');
      return { meters: round(haversine(p, q), 1), km: round(haversine(p, q) / 1000, 3) };
    }
    case 'address': return splitAddress(a.text);
    case 'enrich': {
      const items = Array.isArray(a.items) ? a.items.slice(0, 500) : [];
      let found = 0;
      const rows = items.map((it) => {
        const g = findLatLng(it, { tm });
        if (!g) return it;
        found += 1;
        return { ...it, _geo: { lat: round(g.lat, 7), lng: round(g.lng, 7), source: g.source } };
      });
      return { 입력: items.length, 좌표추가: found, 항목: rows };
    }
    default:
      throw new Error(`action 은 parse|to_tm|from_tm|distance|address|enrich 중 하나여야 합니다. (지원 좌표계: ${Object.keys(PROJECTIONS).join(', ')})`);
  }
}

export function registerGeoTools(server) {
  server.tool('geo', {
    description: '한국 공공데이터의 좌표·주소 형식을 변환한다(오프라인 계산). action: parse(문자열 좌표→위경도, 도분초·위경도 뒤바뀜 보정), '
      + 'to_tm/from_tm(WGS84↔한국 TM, tm=EPSG:5179/5185~5188 기본 5186), distance(두 좌표 거리), address(시도/시군구 분리·정규화), '
      + 'enrich(API 결과 items 에 위도/경도/mapx·mapy/XCOORD 등을 찾아 _geo 추가).',
    inputSchema: { type: 'object', required: ['action'], properties: {
      action: { type: 'string', enum: ['parse', 'to_tm', 'from_tm', 'distance', 'address', 'enrich'] },
      text: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' },
      from: { type: 'string' }, to: { type: 'string' }, tm: { type: 'string', description: '좌표계 (기본 EPSG:5186)' },
      items: { type: 'array', items: { type: 'object' }, description: 'enrich 대상 (최대 500)' },
    } },
  }, async (a) => out(geoAction(a)));
}
