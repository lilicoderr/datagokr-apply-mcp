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

function after(text, label) {
  const m = text.match(new RegExp(`${label}[^A-Za-z0-9%]{0,40}(${TOKEN})`, 'i'));
  return m ? m[1] : null;
}

/**
 * @param {string} html
 * @returns {{ encoding: string|null, decoding: string|null } | null} 못 찾으면 null
 */
export function extractServiceKeys(html) {
  const text = toText(html);
  const i = text.search(/일반\s*인증키/);
  const scope = i >= 0 ? text.slice(i, i + 1500) : text;
  let encoding = after(scope, 'Encoding');
  let decoding = after(scope, 'Decoding');
  if (!encoding && !decoding) return null;
  try {
    if (!decoding && encoding) decoding = decodeURIComponent(encoding);
    if (!encoding && decoding) encoding = encodeURIComponent(decoding);
  } catch { /* 변환 실패 시 있는 것만 반환 */ }
  return { encoding, decoding };
}

/** 사람이 보는 모든 출력용 마스킹 (앞 4 + … + 뒤 2) */
export function maskSecret(k) {
  const s = String(k || '');
  return s.length <= 8 ? '****' : `${s.slice(0, 4)}…${s.slice(-2)} (${s.length}자)`;
}
