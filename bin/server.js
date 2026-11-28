#!/usr/bin/env node
// 공공데이터포털 MCP 서버 엔트리.
//   (인자 없음)        stdio 로 MCP 클라이언트(Claude 등)와 통신
//   doctor            환경 점검 리포트를 출력하고 종료 (문제 있으면 exit 1)
//   --version, --help
import { createServer } from '../src/mcp.js';
import { createRegistry } from '../src/registry.js';
import { registerTools } from '../src/tools.js';
import { createUsage } from '../src/usage.js';
import { createCache } from '../src/cache.js';
import { formatPrintConfig } from '../src/printconfig.js';
import { loggerFromEnv } from '../src/logger.js';
import { registerResources } from '../src/resources.js';
import { registerApplyTools } from '../src/tools-apply.js';
import * as apply from '../src/apply.js';
import { registerUseTool } from '../src/tools-use.js';
import { runDoctor, formatReport, exitCode, applyFixes, formatFixes } from '../src/doctor.js';
import { annotateTools } from '../src/annotations.js';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const arg = process.argv[2];

const HELP = `datagokr-apply-mcp v${pkg.version}

사용법:
  datagokr-apply-mcp           MCP 서버 시작 (stdio) — 보통 Claude 가 실행
  datagokr-apply-mcp doctor    설치/키/네트워크/브라우저/세션 점검
  datagokr-apply-mcp doctor --fix   고칠 수 있는 것(설정 파일·권한·Chromium)은 자동 수정
  datagokr-apply-mcp --print-config [claude-desktop|claude-code|cursor|all]
                               클라이언트별 설치 스니펫 출력
  datagokr-apply-mcp --version

환경 변수:
  DATAGO_CONFIG   키 저장 파일 (기본 ~/.datago-mcp.json)
  DATAGO_USAGE    호출량 집계 파일 (기본 ~/.datago-usage.json)
  DATAGO_HOME     로그인 세션 폴더 (기본 ~/.datagokr-mcp)
  DATAGO_DEBUG    1 이면 debug 로그를 stderr 로 출력 (serviceKey·쿠키·저장된 키는 ***)
  DATAGO_LOG_LEVEL   error|warn|info|debug (JSON lines, stderr)  DATAGO_LOG_FORMAT=text 로 평문`;

if (arg === '--version' || arg === '-v') {
  console.log(pkg.version);
  process.exit(0);
}
if (arg === '--help' || arg === '-h') {
  console.log(HELP);
  process.exit(0);
}

if (arg === '--print-config') {
  try {
    const script = fileURLToPath(new URL('./server.js', import.meta.url));
    console.log(formatPrintConfig(process.argv[3], { script }));
    process.exit(0);
  } catch (e) { console.error(e.message); process.exit(2); }
}

const registry = createRegistry();
const usage = createUsage();

if (arg === 'doctor') {
  let results = await runDoctor({ registry, usage, apply });
  console.log(`datagokr-apply-mcp v${pkg.version} 점검\n`);
  console.log(formatReport(results));
  if (process.argv.includes('--fix')) {
    const runCommand = (cmd, args) => new Promise((resolve) => {
      const p = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
      p.on('close', (c) => resolve(c ?? 1));
      p.on('error', () => resolve(1));
    });
    console.log('\n--- 자동 수정 ---');
    console.log(formatFixes(await applyFixes(results, { registry, runCommand })));
    results = await runDoctor({ registry, usage, apply });
    console.log('\n--- 다시 점검 ---');
    console.log(formatReport(results));
  }
  process.exit(exitCode(results));
}

const server = createServer({ name: 'datagokr-mcp', version: pkg.version });
// DATAGO_DEBUG=1 이면 요청/응답 상태를 stderr 로 남긴다 (serviceKey 는 가림)
const logger = loggerFromEnv(process.env, {
  secrets: () => Object.keys(registry.listKeys().keys).map((n) => registry.getKey(n)), // 저장된 키 원문은 로그에서 항상 가림
});
registerTools(server, { registry, usage, logger, cache: createCache() });
registerResources(server, { registry, usage });
registerApplyTools(server, { registry }); // 활용신청 자동화(playwright-core 있을 때만)
registerUseTool(server, { registry, usage, logger }); // 원클릭 use_api
server.tool('doctor', {
  description: '설치·키·네트워크·브라우저·로그인 세션을 점검해 "왜 안 되는지"와 고치는 방법을 알려준다. '
    + '호출이 실패하거나 apply_* 가 안 보일 때 먼저 실행하라.',
}, async () => {
  const results = await runDoctor({ registry, usage, apply });
  return { content: [{ type: 'text', text: formatReport(results) }] };
});

annotateTools(server);

// stderr 로그만 사용 (stdout 은 프로토콜 전용)
console.error(`[datagokr-mcp] v${pkg.version} 시작 — 도구 ${server.tools.size}개`);
server.listen();
