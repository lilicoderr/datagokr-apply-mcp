// CLI: datagokr-apply-mcp use <dataId|url> [--confirm] [--dry-run] [--operation X] [--param k=v ...] [--alias A] [--key-name N] [--purpose T] [--reapply] [--show-browser] [--json]
import { createUse, formatUse } from './tools-use.js';

/** @param {string[]} argv */
export function parseUseArgs(argv) {
  /** @type {Record<string, any>} */
  const a = { params: {} };
  const rest = [];
  const need = (i, f) => { if (argv[i + 1] === undefined) throw new Error(`${f} 값이 필요해요.`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--confirm' || t === '--yes') a.confirm = true;
    else if (t === '--dry-run') a.dryRun = true;
    else if (t === '--reapply') a.reapply = true;
    else if (t === '--show-browser') a.showBrowser = true;
    else if (t === '--json') a.json = true;
    else if (t === '--param') {
      const kv = need(i++, t); const eq = kv.indexOf('=');
      if (eq < 1) throw new Error(`--param 은 key=value 형태예요: ${kv}`);
      a.params[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else if (['--operation', '--alias', '--key-name', '--purpose'].includes(t)) {
      a[t.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = need(i++, t);
    } else if (t.startsWith('--')) throw new Error(`알 수 없는 옵션: ${t}`);
    else rest.push(t);
  }
  if (rest.length !== 1) throw new Error('사용법: datagokr-apply-mcp use <데이터id|URL> [--dry-run] [--confirm] [--param k=v] ...');
  return /** @type {Record<string, any>} */ ({ ...a, idOrUrl: rest[0] });
}

/** 종료 코드: ready·dry_run 은 0, 사용자 조치가 필요한 상태(확인·로그인·대기 등)는 2, 오류는 1 */
export function exitCodeFor(out) {
  if (out.status === 'ready' || out.status === 'dry_run') return 0;
  return ['invalid_input', 'call_failed', 'apply_failed', 'unsupported', 'blocked_host'].includes(out.status) ? 1 : 2;
}

/** @param {string[]} argv @param {import('./types.js').Options} deps @param {{ log?: (s: string) => void, signal?: AbortSignal }} [io] */
export async function runUseCli(argv, deps, { log = console.log, signal } = {}) {
  let args;
  try { args = parseUseArgs(argv); } catch (e) { log(e.message); return 1; }
  const { json, ...rest } = args;
  const out = await createUse(deps)(rest, { signal, progress: (n, t, m) => { if (!json) console.error(`[${n}/${t}] ${m || ''}`); } });
  log(json ? JSON.stringify(out, null, 2) : formatUse(out));
  return exitCodeFor(out);
}
