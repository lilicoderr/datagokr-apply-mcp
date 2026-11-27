// MCP Streamable HTTP 전송 (선택). 기본은 127.0.0.1 에서만 열고, 토큰이 있으면 Bearer 인증을 요구한다.
//
//   POST /mcp   JSON-RPC 메시지 1개(또는 배열) → application/json 응답, 알림만 있으면 202
//   GET  /mcp   405 (서버 주도 SSE 스트림은 제공하지 않음)
//   DELETE /mcp 200 (세션 없음 — 무상태)
//
// 토큰은 환경변수(DATAGO_HTTP_TOKEN)로만 받는다. 로그에 남기지 않는다.
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

export const MAX_BODY = 1024 * 1024; // 1MB
const LOCAL = new Set(['127.0.0.1', 'localhost', '::1']);

function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(payload);
}

// Origin 헤더가 있으면 로컬 호스트여야 한다 (DNS rebinding / 브라우저 CSRF 방지)
function originAllowed(origin) {
  if (!origin) return true;
  try { return LOCAL.has(new URL(origin).hostname.replace(/^\[|\]$/g, '')); } catch { return false; }
}

/**
 * @param {any} server
 * @param {import('./types.js').Options} [options]
 */
export function createHttpHandler(server, { token, path = '/mcp' } = {}) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== path) return send(res, 404, { error: 'not found' });
      if (!originAllowed(req.headers.origin)) return send(res, 403, { error: 'origin not allowed' });
      if (token) {
        const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
        if (!m || !safeEqual(m[1], token)) {
          return send(res, 401, { error: 'unauthorized' }, { 'www-authenticate': 'Bearer' });
        }
      }
      if (req.method === 'DELETE') return send(res, 200, {});
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }, { allow: 'POST, DELETE' });

      let size = 0; const chunks = [];
      for await (const c of req) {
        size += c.length;
        if (size > MAX_BODY) return send(res, 413, { error: 'payload too large' });
        chunks.push(c);
      }
      let msg;
      try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
        return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      }
      const batch = Array.isArray(msg);
      const out = (await Promise.all((batch ? msg : [msg]).map((m) => server.handle(m)))).filter(Boolean);
      if (!out.length) { res.writeHead(202); return res.end(); }
      return send(res, 200, batch ? out : out[0]);
    } catch (e) {
      return send(res, 500, { error: 'internal error' });
    }
  };
}

// 비로컬 호스트에 바인딩하려면 토큰이 필수다.
export function assertBindable(host, token) {
  if (!LOCAL.has(host) && !token) {
    throw new Error(`--http 를 ${host} 에 열려면 DATAGO_HTTP_TOKEN 이 필요합니다 (기본은 127.0.0.1 만).`);
  }
}

/**
 * @param {any} server
 * @param {import('./types.js').Options} [options]
 */
export function startHttp(server, { host = '127.0.0.1', port = 3000, token = '' } = {}) {
  assertBindable(host, token);
  const srv = http.createServer(createHttpHandler(server, { token }));
  return new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(port, host, () => resolve(srv));
  });
}
