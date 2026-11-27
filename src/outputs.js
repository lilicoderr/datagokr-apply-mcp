// 구조화된 도구 출력 (MCP 2025-06-18: outputSchema + structuredContent).
// 텍스트(content)는 그대로 유지해 구형 클라이언트와 호환하고, 같은 데이터를 structuredContent 로도 준다.

export function structured(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }], structuredContent: obj };
}

const obj = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
const SUMMARY = obj({
  ok: { type: 'boolean' }, httpStatus: { type: 'number' }, resultCode: { type: ['string', 'number'] },
  의미: { type: 'string' }, 응답형식: { type: 'string' },
}, ['ok']);

export const OUTPUT_SCHEMAS = {
  call_api: obj({
    요약: SUMMARY, 데이터: {}, 페이징: { type: 'object' }, 항목수: { type: 'number' },
    항목: { type: 'array' }, 생략됨: { type: 'number' }, 잘림: { type: 'boolean' },
  }, ['요약']),
  fetch_all: obj({
    요약: SUMMARY, 조회페이지: { type: 'number' }, totalCount: { type: ['number', 'null'] },
    가져온항목수: { type: 'number' }, 잘림: { type: 'boolean' }, 항목: { type: 'array' },
  }, ['요약', '조회페이지', '가져온항목수', '항목']),
  export_data: obj({
    요약: SUMMARY, 저장됨: { type: 'string' }, 행수: { type: 'number' }, 바이트: { type: 'number' },
    조회페이지: { type: 'number' }, totalCount: { type: ['number', 'null'] }, 잘림: { type: 'boolean' },
  }, ['요약']),
  quota_status: obj({
    day: { type: 'string' }, limit: { type: 'number' }, total: { type: 'number' }, byKey: { type: 'object' },
  }, ['day', 'limit', 'total', 'byKey']),
  list_keys: obj({ defaultKey: { type: ['string', 'null'] }, keys: { type: 'object' } }, ['keys']),
};

export function attachOutputSchemas(server) {
  for (const [name, schema] of Object.entries(OUTPUT_SCHEMAS)) {
    const entry = server.tools.get(name);
    if (entry && !entry.def.outputSchema) entry.def.outputSchema = schema;
  }
  return server;
}
