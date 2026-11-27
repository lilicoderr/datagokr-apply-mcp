// 호출 대상 검증. 모델(또는 프롬프트 인젝션)이 임의 URL 을 넘겨 서비스 키를 엉뚱한 곳으로
// 보내거나 내부망(SSRF)을 두드리지 못하게 한다.
//
//   · http/https 만 허용
//   · 루프백/사설/링크로컬 주소 차단 (DATAGO_ALLOW_LOCAL=1 이면 허용 — 개발/테스트용)
//   · DATAGO_ALLOWED_HOSTS="data.go.kr,openapi.seoul.go.kr" 를 주면 해당 도메인(및 하위)만 허용

import net from 'node:net';

function isPrivateIPv4(h) {
  const [a, b] = h.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export function isPrivateHost(hostname) {
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
  const v = net.isIP(h);
  if (v === 4) return isPrivateIPv4(h);
  if (v === 6) {
    const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIPv4(mapped[1]);
    const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/); // URL 정규화 결과 형태
    if (hex) {
      const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
      return isPrivateIPv4([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
    }
    return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h);
  }
  return false;
}

export function assertSafeTarget(rawUrl, env = process.env) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new Error(`URL 형식이 올바르지 않아요: ${rawUrl}`); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error(`http/https URL 만 호출할 수 있어요 (받은 값: ${u.protocol})`);
  if (u.username || u.password) throw new Error('URL 에 계정 정보(user:pass@)를 넣을 수 없어요.');
  const allowed = String(env.DATAGO_ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length) {
    const h = u.hostname.toLowerCase();
    if (!allowed.some((d) => h === d || h.endsWith(`.${d}`))) {
      throw new Error(`허용되지 않은 호스트예요: ${h} (DATAGO_ALLOWED_HOSTS=${allowed.join(',')})`);
    }
  } else if (env.DATAGO_ALLOW_LOCAL !== '1' && isPrivateHost(u.hostname)) {
    throw new Error(`내부/로컬 주소(${u.hostname})로는 호출하지 않아요. 로컬 서버를 테스트하려면 DATAGO_ALLOW_LOCAL=1 을 설정하세요.`);
  }
  return u;
}
