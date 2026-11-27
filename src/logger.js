// 구조화 로깅(JSON lines → stderr) + 비밀값 마스킹. stdout 은 MCP 프로토콜 전용이라 절대 쓰지 않는다.
//
//   DATAGO_LOG_LEVEL = error | warn | info | debug (기본 off), DATAGO_DEBUG=1 은 debug 와 같음
//   DATAGO_LOG_FORMAT = json | text (기본 json)

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const SECRET_FIELD = /^(servicekey|service_key|key|apikey|api_key|authorization|cookie|set-cookie|password|token|secret|storagestate)$/i;

export function redactString(s, secrets = []) {
  let out = String(s);
  out = out.replace(/([?&;\s"']servicekey(?:=|"?\s*:\s*"?))[^&\s"',]*/gi, '$1***');
  out = out.replace(/(authorization["']?\s*[:=]\s*["']?)(?:bearer|basic)?\s*[^\s"',]+/gi, '$1***');
  out = out.replace(/((?:set-)?cookie["']?\s*[:=]\s*["']?)[^\r\n"']+/gi, '$1***');
  for (const sec of secrets) if (sec && String(sec).length >= 8) out = out.split(sec).join('***');
  return out;
}

export function redact(value, secrets = [], depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value, secrets);
  if (typeof value !== 'object') return value;
  if (depth > 6) return '[depth]';
  if (Array.isArray(value)) return value.map((v) => redact(v, secrets, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_FIELD.test(k) ? '***' : redact(v, secrets, depth + 1);
  return out;
}

export function createLogger({ level = 'off', format = 'json', write = (l) => process.stderr.write(l + '\n'), secrets = () => [], now = () => new Date() } = {}) {
  const max = level in LEVELS ? LEVELS[level] : -1;
  function log(lvl, msg, fields = {}) {
    if (LEVELS[lvl] > max) return;
    const sec = secrets();
    const rec = { ts: now().toISOString(), level: lvl, msg: redactString(msg, sec), ...redact(fields, sec) };
    write(format === 'text'
      ? `[datagokr-mcp] ${rec.level} ${rec.msg}${Object.keys(fields).length ? ' ' + JSON.stringify(redact(fields, sec)) : ''}`
      : JSON.stringify(rec));
  }
  // callApi 의 logger 는 문자열 하나를 받는 함수 → debug 로 연결
  const fn = (msg) => log('debug', msg);
  Object.assign(fn, {
    enabled: max >= 0,
    error: (m, f) => log('error', m, f), warn: (m, f) => log('warn', m, f),
    info: (m, f) => log('info', m, f), debug: (m, f) => log('debug', m, f),
  });
  return fn;
}

export function loggerFromEnv(env = process.env, opts = {}) {
  const level = env.DATAGO_LOG_LEVEL || (env.DATAGO_DEBUG ? 'debug' : 'off');
  return createLogger({ level, format: env.DATAGO_LOG_FORMAT === 'text' ? 'text' : 'json', ...opts });
}
