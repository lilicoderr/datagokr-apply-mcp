// 오류 카탈로그 문서를 코드(RESULT_CODES / RESULT_HINTS / 재시도 규칙)에서 생성한다.
// 생성: npm run docs:errors   (test/errorcatalog.test.js 가 문서가 최신인지 검사)

import { RESULT_CODES, RESULT_HINTS, RETRYABLE_CODES } from './datago.js';

const cell = (s) => String(s ?? '').replace(/\|/g, '\|');

export function buildErrorCatalog() {
  const codes = Object.keys(RESULT_CODES).sort();
  const rows = codes.map((c) => `| \`${c}\` | ${cell(RESULT_CODES[c])} | ${RETRYABLE_CODES.has(c) ? 'yes (backoff)' : 'no'} | ${cell(RESULT_HINTS[c] || '-')} |`);
  return [
    '# Error catalog',
    '',
    '> Generated from `src/datago.js` by `npm run docs:errors`. Do not edit by hand.',
    '',
    'data.go.kr returns errors as **HTTP 200** with a `resultCode` in the body, so always check the code, not just the status.',
    '',
    '## resultCode',
    '',
    '| Code | Meaning | Auto-retried | What to do |',
    '|---|---|---|---|',
    ...rows,
    '',
    '## Transport-level conditions',
    '',
    '| Condition | Behavior |',
    '|---|---|',
    '| HTTP 429 / 5xx, network error, timeout | Retried with exponential backoff (base 500 ms, max 8 s, 2 retries) |',
    '| resultCode `30` | Retried once with the opposite key encoding (Encoding vs Decoding) |',
    '| Consecutive failures on one host | Per-host circuit breaker opens (5 failures, 30 s cooldown) and calls fail fast with `CircuitOpenError` |',
    '',
  ].join('\n');
}
