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

export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL = '2024-11-05';

export function createServer({ name = 'mcp-server', version = '0.0.0' } = {}) {
  const tools = new Map(); // name -> { def, handler }
  let initialized = false;

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

  function rpcResult(id, result) { return { jsonrpc: '2.0', id, result }; }
  function rpcError(id, code, message, data) {
    const error = { code, message };
    if (data !== undefined) error.data = data;
    return { jsonrpc: '2.0', id, error };
  }

  // 하나의 JSON-RPC 메시지를 처리. 응답 객체를 돌려주고, 알림(notification)이면 null.
  async function handle(msg) {
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
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name, version },
          }));
        }
        case 'notifications/initialized':
        case 'initialized':
          return null; // 알림
        case 'ping':
          return reply(rpcResult(msg.id, {}));
        case 'tools/list':
          return reply(rpcResult(msg.id, { tools: [...tools.values()].map((t) => t.def) }));
        case 'tools/call': {
          const toolName = msg.params?.name;
          const entry = tools.get(toolName);
          if (!entry) return reply(rpcError(msg.id, -32602, `알 수 없는 도구: ${toolName}`));
          try {
            const out = await entry.handler(msg.params?.arguments ?? {});
            return reply(rpcResult(msg.id, toToolResult(out)));
          } catch (err) {
            // 도구 실행 오류는 프로토콜 오류가 아니라 content.isError 로 전달 (MCP 권장)
            return reply(rpcResult(msg.id, {
              content: [{ type: 'text', text: `오류: ${err?.message || err}` }],
              isError: true,
            }));
          }
        }
        default:
          return reply(rpcError(msg.id, -32601, `지원하지 않는 메서드: ${msg.method}`));
      }
    } catch (err) {
      return reply(rpcError(msg.id, -32603, `내부 오류: ${err?.message || err}`));
    }
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
        handle(msg)
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

  const api = { tool, handle, listen, get initialized() { return initialized; }, tools };
  return api;
}
