// 실제 응답 항목들로부터 필드 스키마를 추정한다 (타입, 결측률, 예시, enum 후보).

const NUM = /^-?\d+(\.\d+)?$/;
const DATE8 = /^\d{8}$/;
const DATE_ISO = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/;

export function kindOf(v) {
  if (v == null || v === '') return 'empty';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'object';
  const s = String(v).trim();
  if (DATE_ISO.test(s)) return 'date';
  if (DATE8.test(s) && +s.slice(4, 6) >= 1 && +s.slice(4, 6) <= 12 && +s.slice(6) >= 1 && +s.slice(6) <= 31) return 'date(yyyymmdd)';
  if (NUM.test(s) && !/^0\d+/.test(s)) return s.includes('.') ? 'number-string' : 'integer-string';
  return 'string';
}

export function inferSchema(items, { enumMax = 8 } = {}) {
  const rows = items.filter((r) => r && typeof r === 'object' && !Array.isArray(r));
  const fields = new Map();
  for (const row of rows) {
    for (const [k, v] of Object.entries(row)) {
      const f = fields.get(k) || { kinds: new Map(), empty: 0, values: new Set(), example: undefined };
      const kind = kindOf(v);
      if (kind === 'empty') f.empty++;
      else {
        f.kinds.set(kind, (f.kinds.get(kind) || 0) + 1);
        if (f.example === undefined) f.example = v;
        if (f.values.size <= enumMax && typeof v !== 'object') f.values.add(String(v));
      }
      fields.set(k, f);
    }
  }
  const n = rows.length;
  const out = {};
  for (const [k, f] of fields) {
    const kinds = [...f.kinds.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
    const seen = [...f.kinds.values()].reduce((a, b) => a + b, 0);
    out[k] = {
      type: kinds.length === 0 ? 'unknown' : kinds.length === 1 ? kinds[0] : kinds.join('|'),
      nullable: seen < n,
      missingRate: n ? Math.round(((n - seen) / n) * 1000) / 1000 : 0,
      example: f.example,
      ...(f.values.size > 0 && f.values.size <= enumMax && n >= 5 && seen > f.values.size ? { enum: [...f.values] } : {}),
    };
  }
  return { sampleSize: n, fields: out };
}
