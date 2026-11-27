// 항목 배열을 CSV/JSON 파일로 저장한다. 파일은 항상 내보내기 폴더 안에만 만든다(경로 이탈 차단).
//
//   기본 폴더: $DATAGO_EXPORT_DIR, 없으면 ~/datago-exports

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function defaultExportDir() {
  return process.env.DATAGO_EXPORT_DIR || path.join(os.homedir(), 'datago-exports');
}

// 중첩 객체는 "a.b" 형태로 펼치고, 배열은 JSON 문자열로 둔다.
export function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
  }
  return out;
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // 스프레드시트 수식 주입 방지: = + - @ 로 시작하는 문자열 앞에 ' 를 붙인다 (숫자는 그대로)
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(items) {
  const rows = items.map((it) => flatten(it));
  const cols = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  const lines = [cols.map(csvCell).join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}

export function safeFileName(name, ext) {
  const base = String(name || 'export').replace(/(?<=[^.])\.[A-Za-z0-9]+$/, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^[._]+/, '').slice(0, 80) || 'export';
  return `${base}.${ext}`;
}

export function writeExport(items, { format = 'csv', name, dir = defaultExportDir() } = {}) {
  if (!['csv', 'json'].includes(format)) throw new Error("format 은 'csv' 또는 'json' 입니다.");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, safeFileName(name, format));
  if (path.relative(dir, file).startsWith('..')) throw new Error('내보내기 폴더 밖에는 저장할 수 없어요.');
  // CSV 는 BOM 을 붙여야 엑셀에서 한글이 깨지지 않는다
  const body = format === 'csv' ? `﻿${toCsv(items)}` : JSON.stringify(items, null, 2) + '\n';
  fs.writeFileSync(file, body, 'utf8');
  return { file, rows: items.length, bytes: Buffer.byteLength(body) };
}
