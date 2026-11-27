// 아주 작은 MCP(Model Context Protocol) 서버 — 의존성 없음.
//
//   · 전송: stdio 위의 줄 단위(newline-delimited) JSON-RPC 2.0
//   · 핸드셰이크: initialize → (notifications/initialized) → tools/list, tools/call
//
//   사용:
//     const s = createServer({ name, version });
//     s.tool('search', { description, inputSchema }, async (args) => '결과 텍스트');
//     s.listen();                      // stdin/stdout 에 연결
//     // 테스트: s.handle(messageObject) 로 요청 객체를 직접 처리

import { hintForError } from './errorhints.js';

export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL = '2024-11-05';

export class CancelledError extends Error {
  constructor(reason) { super(reason ? `취소됨: ${reason}` : '취소됨'); this.name = 'CancelledError'; }
}

export function createServer({ name = 'mcp-server', version = '0.0.0' } = {}) {
  const tools = new Map(); // name -> { def, handler }
  const resources = new Map(); // uri -> { def, read }
  const prompts = new Map(); // name -> { def, build }
  let initialized = false;
  const inflight = new Map(); // 요청 id -> AbortController (notifications/cancelled 용)

  /**
   * @param {string} toolName
   * @param {{description?: string, inputSchema?: object, outputSchema?: object, annotations?: import('./types.js').ToolAnnotations}} def
   * @param {(args: any, ctx: import('./types.js').ToolContext) => Promise<string | object | import('./types.js').ToolResult> | string | object} handler
   */
  function tool(toolName, def, handler) {
    tools.set(toolName, {
      def: {
        name: toolName,
        description: def.description || '',
        inputSchema: def.inputSchema || { type: 'object', properties: {} },
      },
      handler,
    });
    return api;
  }

  function resource(uri, def, read) {
    resources.set(uri, {
      def: { uri, name: def.name || uri, description: def.description || '', mimeType: def.mimeType || 'text/plain' },
      read,
    });
    return api;
  }

  function prompt(promptName, def, build) {
    prompts.set(promptName, {
      def: { name: promptName, description: def.description || '', arguments: def.arguments || [] },
      build,
    });
    return api;
  }

  function rpcResult(id, result) { return { jsonrpc: '2.0', id, result }; }
  function rpcError(id, code, message, data) {
    const error = { code, message };
    if (data !== undefined) error.data = data;
    return { jsonrpc: '2.0', id, error };
  }

  // 하나의 JSON-RPC 메시지를 처리. 응답 객체를 돌려주고, 알림(notification)이면 null.
  //   opts.notify(obj): 서버→클라이언트 알림(진행률 등)을 내보내는 함수 (전송 계층이 제공, 없으면 알림은 버림)
  async function handle(msg, opts = {}) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return msg?.id !== undefined ? rpcError(msg.id ?? null, -32600, 'Invalid Request') : null;
    }
    const isNotification = msg.id === undefined || msg.id === null;
    const reply = (res) => (isNotification ? null : res);

    try {
      switch (msg.method) {
        case 'initialize': {
          const asked = msg.params?.protocolVersion;
          const protocolVersion = PROTOCOL_VERSIONS.includes(asked) ? asked : DEFAULT_PROTOCOL;
          initialized = true;
          return reply(rpcResult(msg.id, {
            protocolVersion,
            capabilities: {
              tools: { listChanged: false },
              ...(resources.size ? { resources: { listChanged: false, subscribe: false } } : {}),
              ...(prompts.size ? { prompts: { listChanged: false } } : {}),
            },
            serverInfo: { name, version },
          }));
        }
        case 'notifications/initialized':
        case 'initialized':
          return null; // 알림
        case 'notifications/cancelled': {
          // 취소 알림: 진행 중 요청을 중단하고, 스펙대로 그 요청에는 응답하지 않는다.
          const rid = msg.params?.requestId;
          inflight.get(rid)?.abort(new CancelledError(msg.params?.reason));
          return null;
        }
        case 'ping':
          return reply(rpcResult(msg.id, {}));
        case 'tools/list':
          return reply(rpcResult(msg.id, { tools: [...tools.values()].map((t) => t.def) }));
        case 'tools/call': {
          const toolName = msg.params?.name;
          const entry = tools.get(toolName);
          if (!entry) return reply(rpcError(msg.id, -32602, `알 수 없는 도구: ${toolName}`));
          try {
            const ctrl = new AbortController();
            if (!isNotification) inflight.set(msg.id, ctrl);
            const ctx = makeContext(msg, opts, ctrl.signal);
            let out;
            try {
              out = await Promise.race([
                entry.handler(msg.params?.arguments ?? {}, ctx),
                new Promise((_, rej) => ctrl.signal.addEventListener('abort', () => rej(ctrl.signal.reason), { once: true })),
              ]);
            } finally { inflight.delete(msg.id); }
            return reply(rpcResult(msg.id, toToolResult(out)));
          } catch (err) {
            if (err instanceof CancelledError) return null; // 취소된 요청에는 응답하지 않는다
            // 도구 실행 오류는 프로토콜 오류가 아니라 content.isError 로 전달 (MCP 권장)
            const message = String(err?.message || err);
            const hint = hintForError(err);
            return reply(rpcResult(msg.id, {
              content: [{ type: 'text', text: `오류: ${message}\nhint: ${hint}` }],
              structuredContent: { ok: false, error: message, hint },
              isError: true,
            }));
          }
        }
        case 'resources/list':
          return reply(rpcResult(msg.id, { resources: [...resources.values()].map((r) => r.def) }));
        case 'resources/read': {
          const uri = msg.params?.uri;
          const entry = resources.get(uri);
          if (!entry) return reply(rpcError(msg.id, -32002, `알 수 없는 리소스: ${uri}`));
          const body = await entry.read();
          const text = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
          return reply(rpcResult(msg.id, { contents: [{ uri, mimeType: entry.def.mimeType, text }] }));
        }
        case 'prompts/list':
          return reply(rpcResult(msg.id, { prompts: [...prompts.values()].map((p) => p.def) }));
        case 'prompts/get': {
          const entry = prompts.get(msg.params?.name);
          if (!entry) return reply(rpcError(msg.id, -32602, `알 수 없는 프롬프트: ${msg.params?.name}`));
          const args = msg.params?.arguments ?? {};
          for (const a of entry.def.arguments) {
            if (a.required && !args[a.name]) return reply(rpcError(msg.id, -32602, `필수 인자 누락: ${a.name}`));
          }
          const built = await entry.build(args);
          const messages = typeof built === 'string'
            ? [{ role: 'user', content: { type: 'text', text: built } }] : built;
          return reply(rpcResult(msg.id, { description: entry.def.description, messages }));
        }
        default:
          return reply(rpcError(msg.id, -32601, `지원하지 않는 메서드: ${msg.method}`));
      }
    } catch (err) {
      return reply(rpcError(msg.id, -32603, `내부 오류: ${err?.message || err}`));
    }
  }

  // 도구 핸들러에 넘기는 두 번째 인자. progress(현재, 전체?, 메시지?) 는 클라이언트가
  // _meta.progressToken 을 보냈을 때만 notifications/progress 를 내보내고, 값은 단조 증가만 허용한다.
  function makeContext(msg, opts, signal) {
    const token = msg.params?._meta?.progressToken;
    let last = -Infinity;
    return {
      requestId: msg.id,
      signal,
      progress(progress, total, message) {
        if (token === undefined || token === null || !opts.notify) return false;
        if (!(progress > last)) return false;
        last = progress;
        const params = { progressToken: token, progress };
        if (total !== undefined && total !== null) params.total = total;
        if (message) params.message = message;
        try { opts.notify({ jsonrpc: '2.0', method: 'notifications/progress', params }); } catch { /* 전송 실패는 도구를 막지 않음 */ }
        return true;
      },
    };
  }

  // 핸들러 반환값을 MCP tools/call 결과 형태로 정규화
  function toToolResult(out) {
    if (out && typeof out === 'object' && Array.isArray(out.content)) return out; // 이미 형식에 맞음
    const text = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
    return { content: [{ type: 'text', text }] };
  }

  // stdio 연결 (줄 단위 JSON). 테스트에서는 호출하지 않는다.
  function listen({ input = process.stdin, output = process.stdout } = {}) {
    let buf = '';
    let pending = 0;
    let ended = false;
    const maybeExit = () => { if (ended && pending === 0) process.exit(0); };

    input.setEncoding('utf8');
    input.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { write(output, rpcError(null, -32700, 'Parse error')); continue; }
        pending++;
        handle(msg, { notify: (n) => write(output, n) })
          .then((res) => { if (res) write(output, res); })
          .catch(() => { /* handle 은 내부에서 이미 처리 */ })
          .finally(() => { pending--; maybeExit(); });
      }
    });
    // stdin 이 닫혀도 처리 중인 요청이 끝날 때까지 기다렸다 종료 (파이프 입력 안전)
    input.on('end', () => { ended = true; maybeExit(); });
  }

  function write(output, obj) {
    output.write(JSON.stringify(obj) + '\n');
  }

  const api = { tool, resource, prompt, handle, listen, get initialized() { return initialized; }, tools };
  return api;
}

