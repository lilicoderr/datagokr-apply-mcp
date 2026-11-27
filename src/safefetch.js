// 서비스 키를 싣는 요청 전용 fetch (의존성 없음, node:http/https).
//
//   전역 fetch 는 "검사할 때"와 "연결할 때" DNS 를 따로 조회해서, 그 사이에 답을 바꾸는 DNS rebinding 에 뚫린다.
//   여기서는 연결에 실제로 쓰는 lookup 안에서 주소를 검사하므로 검사한 주소 = 접속하는 주소다.
//   TLS 인증서·Host 헤더는 원래 호스트명 기준 그대로다. 리다이렉트는 따라가지 않는다.

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { isPrivateHost } from './security.js';

const DECODERS = { gzip: zlib.gunzipSync, 'x-gzip': zlib.gunzipSync, deflate: zlib.inflateSync, br: zlib.brotliDecompressSync };

const blocked = (host, address) => new Error(`${host} 가 내부/로컬 주소(${address})로 해석돼 호출하지 않아요.`);

// net.connect 의 lookup 규약: options.all 이면 배열, 아니면 (address, family)
export function guardedLookup(lookup = dns.lookup) {
  return (hostname, options, callback) => {
    lookup(hostname, { ...options, all: true }, (/** @type {any} */ err, /** @type {any} */ addresses) => {
      if (err) return callback(err);
      const bad = addresses.find((a) => isPrivateHost(a.address));
      if (bad) return callback(blocked(hostname, bad.address));
      if (!addresses.length) return callback(Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }));
      return options.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

/**
 * @param {string} url
 * @param {any} [init] { method, body, signal }
 * @param {{ env?: Record<string, string|undefined>, lookup?: any }} [opts]
 * @returns {Promise<any>} fetch 응답의 부분집합 { ok, status, headers.get, text() }
 */
export function pinnedFetch(url, init = {}, { env = process.env, lookup = dns.lookup } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const guard = env.DATAGO_ALLOW_LOCAL !== '1';
    const host = u.hostname.replace(/^\[|\]$/g, '');
    // IP 리터럴은 lookup 을 거치지 않으므로 여기서 검사
    if (guard && net.isIP(host) && isPrivateHost(host)) { reject(blocked(host, host)); return; }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, {
      method: init.method || 'GET',
      headers: { accept: '*/*', 'user-agent': 'datagokr-apply-mcp', 'accept-encoding': 'gzip, deflate, br' },
      signal: init.signal,
      agent: false, // 다른 경로에서 만든(검사되지 않은) 연결을 재사용하지 않는다
      ...(guard ? { lookup: guardedLookup(lookup) } : {}),
    }, (res) => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.destroy();
        reject(new TypeError('unexpected redirect (리다이렉트는 따라가지 않아요)'));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        try {
          const decode = DECODERS[String(res.headers['content-encoding'] || '').toLowerCase()];
          const buf = Buffer.concat(chunks);
          const body = new TextDecoder().decode(decode && buf.length ? decode(buf) : buf); // fetch 처럼 BOM 제거
          resolve({
            ok: status >= 200 && status < 300,
            status,
            headers: { get: (n) => { const v = res.headers[String(n).toLowerCase()]; return v == null ? null : String(v); } },
            text: async () => body,
          });
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end(init.body);
  });
}
