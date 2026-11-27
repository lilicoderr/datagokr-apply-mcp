// 마이페이지 > 개발계정 HTML 에서 "일반 인증키(Encoding/Decoding)" 를 뽑는 순수 함수.
// 네트워크/브라우저와 무관하므로 고정 픽스처로 테스트한다. 포털 마크업이 바뀌면 여기와 픽스처만 고치면 된다.

const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
const decodeEntities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (m, e) => {
  if (e[0] !== '#') return ENTITIES[e.toLowerCase()];
  const code = /x/i.test(e[1]) ? parseInt(e.slice(2), 16) : Number(e.slice(1));
  return code <= 0x10ffff ? String.fromCodePoint(code) : m;
});

const TOKEN = '[A-Za-z0-9%+/=_\-]{24,}';

function toText(html) {
  const stripped = String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<input[^>]*?value\s*=\s*["']([^"']*)["'][^>]*>/gi, ' $1 ') // input value 도 텍스트로
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(stripped).replace(/\s+/g, ' '); // &nbsp; 는 위에서 공백이 된다
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
  // "일반 인증키" 는 메뉴/안내 문구에도 나올 수 있어, 한 곳만 보지 않고 차례로 확인한다.
  const starts = [...text.matchAll(/일반\s*인증키/g)].map((m) => m.index);
  const found = (starts.length ? starts.map((i) => text.slice(i, i + 1500)) : [text])
    .map((scope) => ({ scope, encs: allAfter(scope, 'Encoding'), decs: allAfter(scope, 'Decoding') }));
  // 무관한 문장 속 "Encoding" 에 속지 않도록, 서로 짝이 맞는 (decode(enc)===dec) 후보를 우선한다.
  for (const { encs, decs } of found) {
    for (const e of encs) {
      const d = decs.find((x) => safeDecode(e) === x);
      if (d) return { encoding: e, decoding: d };
    }
  }
  // 표 머리글에 두 라벨이 나란히 있고 값이 뒤에 오는 배치: 스스로 짝이 증명되는 %인코딩 쌍만 인정한다.
  for (const { scope } of found) {
    const tokens = scope.match(new RegExp(TOKEN, 'g')) || [];
    for (const e of tokens) {
      const d = e.includes('%') ? safeDecode(e) : null;
      if (d && d.length >= KEY_MIN_LEN && tokens.includes(d)) return { encoding: e, decoding: d };
    }
  }
  const first = found.find((f) => f.encs.length || f.decs.length);
  if (!first) return null;
  let encoding = first.encs[0] || null;
  let decoding = first.decs[0] || null;
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
