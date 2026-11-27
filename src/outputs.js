// 구조화된 도구 출력 (MCP 2025-06-18: outputSchema + structuredContent).
// 텍스트(content)는 그대로 유지해 구형 클라이언트와 호환하고, 같은 데이터를 structuredContent 로도 준다.

export function structured(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }], structuredContent: obj };
}

const obj = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
const SUMMARY = obj({
  ok: { type: 'boolean' }, httpStatus: { type: 'number' }, resultCode: { type: ['string', 'number'] },
  meaning: { type: 'string' }, message: { type: ['string', 'null'] }, format: { type: 'string' },
  keyEncoding: { type: 'string' }, retried: { type: 'boolean' }, attempts: { type: 'number' },
  hint: { type: 'string' }, cached: { type: 'boolean' },
}, ['ok']);
const KEYINFO = obj({
  ok: { type: 'boolean' }, saved: { type: 'boolean' }, keyName: { type: 'string' },
  masked: { type: 'string' }, needLogin: { type: 'boolean' }, message: { type: 'string' },
}, ['ok', 'message']);

export const OUTPUT_SCHEMAS = {
  call_api: obj({
    summary: SUMMARY, data: {}, paging: { type: 'object' }, count: { type: 'number' },
    items: { type: 'array' }, omitted: { type: 'number' }, truncated: { type: 'boolean' },
  }, ['summary']),
  fetch_all: obj({
    summary: SUMMARY, pages: { type: 'number' }, totalCount: { type: ['number', 'null'] },
    count: { type: 'number' }, truncated: { type: 'boolean' }, items: { type: 'array' },
  }, ['summary', 'pages', 'count', 'items']),
  export_data: obj({
    summary: SUMMARY, savedTo: { type: ['string', 'null'] }, rows: { type: 'number' }, bytes: { type: 'number' },
    pages: { type: 'number' }, totalCount: { type: ['number', 'null'] }, truncated: { type: 'boolean' },
    message: { type: 'string' },
  }, ['summary', 'rows']),
  quota_status: obj({
    day: { type: 'string' }, limit: { type: 'number' }, total: { type: 'number' }, byKey: { type: 'object' },
    message: { type: 'string' },
  }, ['day', 'limit', 'total', 'byKey']),
  list_keys: obj({ defaultKey: { type: ['string', 'null'] }, keys: { type: 'object' } }, ['keys']),
  apply_api: obj({
    ok: { type: 'boolean' }, total: { type: 'number' }, done: { type: 'number' }, already: { type: 'number' },
    failed: { type: 'number' }, needLogin: { type: 'boolean' }, results: { type: 'array' },
    key: { anyOf: [KEYINFO, { type: 'null' }] }, message: { type: 'string' },
  }, ['ok', 'message']),
  apply_get_key: KEYINFO,
};

export function attachOutputSchemas(server) {
  for (const [name, schema] of Object.entries(OUTPUT_SCHEMAS)) {
    const entry = server.tools.get(name);
    if (entry && !entry.def.outputSchema) entry.def.outputSchema = schema;
  }
  return server;
}
