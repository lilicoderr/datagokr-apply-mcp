// 마이크로 벤치마크 (네트워크 없음): XML/JSON 해석, 항목 추출, CSV 생성, 스키마 추정, 마스킹.
//   node scripts/bench.js [--json]
import { performance } from 'node:perf_hooks';
import { parseXml } from '../src/xml.js';
import { extractItems } from '../src/items.js';
import { flatten } from '../src/export.js';
import { redactString } from '../src/logger.js';
import { buildUrl } from '../src/datago.js';

const N_ROWS = 1000;
const rows = Array.from({ length: N_ROWS }, (_, i) => ({ id: String(i), name: `항목 ${i}`, cnt: String(i * 3), dt: '20240101', nested: { a: i } }));
const xml = `<?xml version="1.0"?><response><header><resultCode>00</resultCode></header><body><items>${rows
  .map((r) => `<item><id>${r.id}</id><name>${r.name}</name><cnt>${r.cnt}</cnt><dt>${r.dt}</dt></item>`).join('')}</items><totalCount>${N_ROWS}</totalCount></body></response>`;
const json = { response: { header: { resultCode: '00' }, body: { items: { item: rows }, totalCount: N_ROWS } } };
const logLine = `GET /a?x=1&serviceKey=${'K'.repeat(64)}&y=2 `.repeat(20);

const cases = [
  [`parseXml (${N_ROWS} items, ${(xml.length / 1024).toFixed(0)} KB)`, () => parseXml(xml)],
  ['extractItems (JSON)', () => extractItems(json)],
  ['flatten x1000 rows', () => rows.map((r) => flatten(r))],
  ['redactString (1.3 KB line)', () => redactString(logLine)],
  ['buildUrl', () => buildUrl('https://apis.data.go.kr/x', { pageNo: 1, numOfRows: 100, q: '한글' }, 'K%2Bkey==')],
];

function bench(fn, budgetMs = 300) {
  for (let i = 0; i < 5; i++) fn(); // warm-up
  const times = [];
  const end = performance.now() + budgetMs;
  while (performance.now() < end || times.length < 10) {
    const t = performance.now();
    fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const q = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))];
  return { runs: times.length, medianMs: q(0.5), p95Ms: q(0.95) };
}

const results = cases.map(([name, fn]) => ({ name, ...bench(fn) }));
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ node: process.version, results }, null, 2));
} else {
  console.log(`node ${process.version}\n`);
  for (const r of results) console.log(`${String(r.name).padEnd(40)} median ${r.medianMs.toFixed(3).padStart(8)} ms   p95 ${r.p95Ms.toFixed(3).padStart(8)} ms   (${r.runs} runs)`);
}
