// describe_api 명세 → TypeScript 타입 힌트. AI/개발자가 응답 필드와 요청 변수를 바로 코드에 옮기도록.

const NUM_NAME = /(cnt|count|num|no|seq|amt|amount|price|rate|year|yy|age|size|len|qty|lat|lng|lon|x|y)$/i;
const NUM_SAMPLE = /^-?\d+(\.\d+)?$/;

export function inferType(name, sample = '') {
  const s = String(sample ?? '').trim();
  if (s && NUM_SAMPLE.test(s) && !/^0\d+/.test(s)) return 'number';
  if (!s && NUM_NAME.test(name)) return 'number';
  return 'string';
}

export function pascal(s) {
  const out = String(s ?? '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  return /^[\p{L}_$]/u.test(out) ? out : `Api${out}`;
}

function key(name) {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

export function toTypeScript(spec, { name } = {}) {
  const base = pascal(name || spec.title || 'Api');
  const lines = [];
  const doc = (ko, extra = '') => {
    const t = [ko, extra].filter(Boolean).join(' — ');
    return t ? `  /** ${t.replace(/\*\//g, '* /')} */` : null;
  };

  lines.push(`export interface ${base}Params {`);
  lines.push('  /** 서비스키 — call_api 가 자동으로 붙이므로 직접 넣을 필요 없음 */');
  lines.push('  serviceKey?: string;');
  for (const r of spec.request || []) {
    if (/^servicekey$/i.test(r.name)) continue;
    const d = doc(r.ko, r.desc && r.desc !== r.ko ? r.desc : '');
    if (d) lines.push(d);
    lines.push(`  ${key(r.name)}${r.required ? '' : '?'}: ${inferType(r.name, r.sample)};`);
  }
  lines.push('}', '');

  lines.push(`export interface ${base}Item {`);
  for (const r of spec.response || []) {
    const d = doc(r.ko);
    if (d) lines.push(d);
    lines.push(`  ${key(r.name)}?: ${inferType(r.name, r.sample)};`);
  }
  lines.push('}', '');

  lines.push(`export interface ${base}Response {`,
    '  response: {',
    '    header: { resultCode: string; resultMsg: string };',
    '    body: {',
    `      items: { item: ${base}Item[] | ${base}Item } | '';`,
    '      numOfRows: number; pageNo: number; totalCount: number;',
    '    };',
    '  };',
    '}', '');
  return lines.join('\n');
}
