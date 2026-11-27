// 마이페이지 > 개발계정 HTML 에서 "일반 인증키(Encoding/Decoding)" 를 뽑는 순수 함수.
// 네트워크/브라우저와 무관하므로 고정 픽스처로 테스트한다. 포털 마크업이 바뀌면 여기와 픽스처만 고치면 된다.

const TOKEN = '[A-Za-z0-9%+/=_\-]{24,}';

function toText(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<input[^>]*?value\s*=\s*["']([^"']*)["'][^>]*>/gi, ' $1 ') // input value 도 텍스트로
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ');
}

function allAfter(text, label) {
  const re = new RegExp(`${label}[^A-Za-z0-9%]{0,40}(${TOKEN})`, 'gi');
  return [...text.matchAll(re)].map((m) => m[1]);
}

const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return null; } };

/**
 * @param {string} html
 * @returns {{ encoding: string|null, decoding: string|null } | null} 못 찾으면 null
 */
export function extractServiceKeys(html) {
  const text = toText(html);
  const i = text.search(/일반\s*인증키/);
  const scope = i >= 0 ? text.slice(i, i + 1500) : text;
  const encs = allAfter(scope, 'Encoding');
  const decs = allAfter(scope, 'Decoding');
  if (!encs.length && !decs.length) return null;
  let encoding = encs[0] || null;
  let decoding = decs[0] || null;
  // 무관한 문장 속 "Encoding" 에 속지 않도록, 서로 짝이 맞는 (decode(enc)===dec) 후보를 우선한다.
  for (const e of encs) {
    const d = decs.find((x) => safeDecode(e) === x);
    if (d) { encoding = e; decoding = d; break; }
  }
  if (!decoding && encoding) decoding = safeDecode(encoding);
  if (!encoding && decoding) encoding = encodeURIComponent(decoding);
  return { encoding, decoding };
}

// 일반 인증키(Decoding 형태) 의 허용 길이. 실제로는 보통 64~100자지만 포털 변경을 감안해 느슨하게 잡는다.
export const KEY_MIN_LEN = 40;
export const KEY_MAX_LEN = 200;

/**
 * 추출 결과가 인증키처럼 보이는지 검사한다. 휴리스틱 추출이라 틀린 토큰을 저장하지 않도록 저장 전에 반드시 거친다.
 * @returns {{ok:boolean, reason?:string}}
 */
export function validateServiceKeys(keys) {
  if (!keys || !keys.encoding || !keys.decoding) return { ok: false, reason: '인코딩/디코딩 형태가 모두 확인되지 않음' };
  const dec = safeDecode(keys.encoding);
  if (dec === null || dec !== keys.decoding) return { ok: false, reason: 'Encoding 값을 디코딩해도 Decoding 값과 일치하지 않음' };
  const n = keys.decoding.length;
  if (n < KEY_MIN_LEN || n > KEY_MAX_LEN) return { ok: false, reason: `키 길이(${n}자)가 예상 범위(${KEY_MIN_LEN}~${KEY_MAX_LEN}자) 밖` };
  if (!/^[A-Za-z0-9+/=_-]+$/.test(keys.decoding)) return { ok: false, reason: '키에 허용되지 않는 문자가 있음' };
  return { ok: true };
}

/** 사람이 보는 모든 출력용 마스킹 (앞 4 + … + 뒤 2) */
export function maskSecret(k) {
  const s = String(k || '');
  return s.length <= 8 ? '****' : `${s.slice(0, 4)}…${s.slice(-2)} (${s.length}자)`;
}
