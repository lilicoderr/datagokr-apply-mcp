// use_api 의 순수/작은 도우미: 시험 호출 파라미터, 응답 분류, 재시도 시점, 별칭 저장.
import { buildExampleParams } from './portal.js';

const blank = (v) => v === undefined || v === null || v === '';

// 명세의 필수 변수 샘플값 + 사용자가 준 값. serviceKey 는 어떤 경로로도 params/예시에 남기지 않는다.
export function prepareParams(request = [], override = {}) {
  const params = { ...buildExampleParams(request) };
  for (const [k, v] of Object.entries(override || {})) {
    const same = Object.keys(params).find((p) => p.toLowerCase() === k.toLowerCase());
    if (same) delete params[same];
    params[k] = v;
  }
  let droppedKey = false;
  for (const k of Object.keys(params)) {
    if (k.toLowerCase() === 'servicekey') { delete params[k]; droppedKey = true; }
  }
  const missing = Object.keys(params).filter((k) => blank(params[k]));
  for (const k of missing) delete params[k];
  return { params, missing, droppedKey };
}

// ok: 정상 / nodata: 키는 통과(데이터만 없음) / inactive: 미승인·승인 반영 전·미등록 키 / failed: 그 밖
export function classifyTest(r) {
  if (r.ok) return 'ok';
  const code = r.resultCode == null ? null : String(r.resultCode).padStart(2, '0');
  if (code === '03' || code === 'INFO-200') return 'nodata';
  if (code === '20' || code === '30') return 'inactive';
  if (code == null && (r.httpStatus === 401 || r.httpStatus === 403)) return 'inactive';
  return 'failed';
}

const HOUR = 3600000;
// 자동승인은 보통 1~2시간. 신청 후 1시간 전이면 그때, 지났으면 30분 뒤. 3시간을 넘기면 지연이 아닐 수 있다.
export function retryPlan(appliedAt, now) {
  const t = Date.parse(appliedAt || '');
  const elapsed = Number.isFinite(t) ? Math.max(0, now - t) : 0;
  const at = Number.isFinite(t) && t + HOUR > now ? t + HOUR : now + HOUR / 2;
  return {
    retryAfter: new Date(at).toISOString(),
    retryInMinutes: Math.ceil((at - now) / 60000),
    overdue: elapsed > 3 * HOUR,
  };
}

// 같은 별칭이 다른 주소를 가리키면 덮어쓰지 않고 -2, -3 … 을 쓴다. 같은 주소면 기존 항목을 그대로 둔다.
export function saveAlias(registry, base, spec) {
  for (let i = 1; i < 100; i++) {
    const name = i === 1 ? base : `${base}-${i}`;
    const cur = registry.getEndpoint(name);
    if (cur && cur.url !== spec.endpoint) continue;
    if (!cur) {
      registry.saveEndpoint(name, spec.endpoint, spec.title, {}, spec.request.filter((r) => r.required).map((r) => r.name));
    }
    return name;
  }
  return null;
}
