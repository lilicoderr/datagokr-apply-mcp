// 도구 실행 중 던져진 오류 → 영어 hint. (메시지는 한국어, hint 는 모델이 읽는 영어 한 줄)
// 오류 객체에 이미 hint 가 있으면(예: portalError) 그것을 우선한다.

/** @type {[RegExp, string][]} */
const RULES = [
  [/서비스 키가 없|저장된 키/, 'No service key available; save one with save_key, or get one with apply_api (check list_keys).'],
  [/저장된 엔드포인트가 없/, 'Unknown endpoint alias; see list_endpoints or pass url directly.'],
  [/url 또는 endpoint|url 이 필요/, 'Pass url (or a saved endpoint alias).'],
  [/허용되지 않은 호스트|공공데이터 호스트/, 'Host not allowed for service keys; set DATAGO_ALLOWED_HOSTS if the agency host is legitimate.'],
  [/내부\/로컬|계정 정보|http\/https/, 'Blocked by the SSRF guard (private address, credentials in URL or non-http scheme).'],
  [/URL 형식|호스트를 찾지/, 'Malformed URL or unresolvable host; check the URL from describe_api.'],
  [/playwright-core/, 'Install optional playwright-core (npm i playwright-core && npx playwright-core install chromium) or run doctor --fix.'],
  [/키가 너무 짧|공백\/줄바꿈|사용할 수 없어요|1~64자/, 'Invalid key/alias/name; copy the full general auth key (no spaces) and use a plain name.'],
  [/내보내기 폴더|format 은/, "Export is limited to the export folder; format must be 'csv' or 'json'."],
  [/응답 시간 초과|네트워크|DNS|연결/, 'Network problem reaching the server; retry later or run doctor.'],
  [/알 수 없는 클라이언트/, 'Unknown client; use claude-desktop | claude-code | cursor | all.'],
];

export function hintForError(err) {
  if (err?.hint) return String(err.hint);
  const msg = String(err?.message || err || '');
  if (err?.name === 'CircuitOpenError' || /차단|circuit/i.test(msg)) return 'Circuit breaker is open for this host after repeated failures; wait and retry.';
  for (const [re, hint] of RULES) if (re.test(msg)) return hint;
  return 'Unexpected error; retry, or run doctor to check the environment.';
}
