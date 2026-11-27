// 호출 대상 검증. 모델(또는 프롬프트 인젝션)이 임의 URL 을 넘겨 서비스 키를 엉뚱한 곳으로
// 보내거나 내부망(SSRF)을 두드리지 못하게 한다.
//
//   · http/https 만 허용, URL 에 계정 정보(user:pass@) 금지
//   · 기본 허용 호스트: data.go.kr 및 하위 도메인, *.go.kr, *.or.kr (공공데이터 제공기관)
//   · DATAGO_ALLOWED_HOSTS="a.com,b.kr" 를 주면 기본 목록 대신 그 도메인(및 하위)만 허용
//   · 루프백/사설/링크로컬 주소 차단 + 호스트명을 DNS 로 풀어 어느 하나라도 사설이면 거부
//   · DATAGO_ALLOW_LOCAL=1 이면 위 호스트/주소 검사를 모두 끈다 (개발/테스트 전용)

import dns from 'node:dns/promises';
import net from 'node:net';

// 내부·특수 용도 대역. BlockList 는 IPv4-mapped(::ffff:a.b.c.d)를 IPv4 규칙으로 검사하고, 표기법(압축/전개/16진)에 의존하지 않는다.
const BLOCKED = new net.BlockList();
for (const [addr, bits] of /** @type {[string, number][]} */ ([
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
])) BLOCKED.addSubnet(addr, bits, 'ipv4');
for (const [addr, bits] of /** @type {[string, number][]} */ ([
  ['::', 96], ['::ffff:0:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2002::', 16], // IPv4 를 감싸는 형태 포함
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
])) BLOCKED.addSubnet(addr, bits, 'ipv6');

export function isPrivateHost(hostname) {
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
  const v = net.isIP(h);
  return v ? BLOCKED.check(h, v === 4 ? 'ipv4' : 'ipv6') : false;
}

// 키가 응답·오류·로그에 되비칠 수 있는 모든 표기(원문/디코딩/인코딩/이중 인코딩/JSON 의 \/ )
export function keyVariants(key) {
  const raw = String(key || '');
  if (raw.length < 8) return [];
  let dec = raw;
  try { dec = decodeURIComponent(raw); } catch { /* 디코딩 불가면 원문만 */ }
  const base = [raw, dec, encodeURIComponent(dec), encodeURIComponent(encodeURIComponent(dec))];
  const all = base.flatMap((v) => [v, v.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()), v.replaceAll('/', '\\/')]);
  return [...new Set(all)].sort((a, b) => b.length - a.length);
}

export function scrubKey(text, key) {
  let out = String(text);
  for (const v of keyVariants(key)) out = out.split(v).join('***');
  return out;
}

const maskQueryKey = (s) => String(s).replace(/(servicekey=)[^&#\s]*/gi, '$1***');

export function assertSafeTarget(rawUrl, env = process.env) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new Error(`URL 형식이 올바르지 않아요: ${maskQueryKey(rawUrl)}`); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error(`http/https URL 만 호출할 수 있어요 (받은 값: ${u.protocol})`);
  if (u.username || u.password) throw new Error('URL 에 계정 정보(user:pass@)를 넣을 수 없어요.');
  if (env.DATAGO_ALLOW_LOCAL === '1') return u;
  const h = u.hostname.toLowerCase();
  const custom = String(env.DATAGO_ALLOWED_HOSTS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (custom.length) {
    if (!custom.some((d) => h === d || h.endsWith(`.${d}`))) {
      throw new Error(`허용되지 않은 호스트예요: ${h} (DATAGO_ALLOWED_HOSTS=${custom.join(',')})`);
    }
  } else if (!isDefaultAllowedHost(h)) {
    throw new Error(`서비스 키는 공공데이터 호스트(data.go.kr, *.go.kr, *.or.kr)로만 보낼 수 있어요: ${h}. 다른 호스트가 필요하면 DATAGO_ALLOWED_HOSTS 로 허용하세요.`);
  }
  if (isPrivateHost(h)) {
    throw new Error(`내부/로컬 주소(${h})로는 호출하지 않아요.`);
  }
  return u;
}

export function isDefaultAllowedHost(h) {
  return h === 'data.go.kr' || h.endsWith('.go.kr') || h.endsWith('.or.kr');
}

// 동기 검사 + DNS 해석. 이름이 사설/루프백/링크로컬 주소로 풀리면 거부한다(DNS rebinding·내부 호스트명 우회 방지).
export async function assertSafeTargetResolved(rawUrl, env = process.env, lookup = dns.lookup) {
  const u = assertSafeTarget(rawUrl, env);
  if (env.DATAGO_ALLOW_LOCAL === '1') return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return u;
  let addrs;
  try { addrs = await lookup(host, { all: true }); } catch (e) {
    throw new Error(`호스트를 찾지 못했어요: ${host} (${e.code || e.message})`);
  }
  const bad = addrs.find((a) => isPrivateHost(a.address));
  if (bad) throw new Error(`${host} 가 내부/로컬 주소(${bad.address})로 해석돼 호출하지 않아요.`);
  return u;
}
