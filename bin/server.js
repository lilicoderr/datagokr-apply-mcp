#!/usr/bin/env node
// 공공데이터포털 MCP 서버 엔트리.
//   (인자 없음)        stdio 로 MCP 클라이언트(Claude 등)와 통신
//   doctor            환경 점검 리포트를 출력하고 종료 (문제 있으면 exit 1)
//   --version, --help
import { createServer } from '../src/mcp.js';
import { createRegistry } from '../src/registry.js';
import { registerTools } from '../src/tools.js';
import { createUsage } from '../src/usage.js';
import { registerApplyTools } from '../src/tools-apply.js';
import * as apply from '../src/apply.js';
import { runDoctor, formatReport, exitCode } from '../src/doctor.js';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const arg = process.argv[2];

const HELP = `datagokr-apply-mcp v${pkg.version}

사용법:
  datagokr-apply-mcp           MCP 서버 시작 (stdio) — 보통 Claude 가 실행
  datagokr-apply-mcp doctor    설치/키/네트워크/브라우저/세션 점검
  datagokr-apply-mcp --version

환경 변수:
  DATAGO_CONFIG   키 저장 파일 (기본 ~/.datago-mcp.json)
  DATAGO_USAGE    호출량 집계 파일 (기본 ~/.datago-usage.json)
  DATAGO_HOME     로그인 세션 폴더 (기본 ~/.datagokr-mcp)
  DATAGO_DEBUG    1 이면 요청 URL/상태를 stderr 로 출력 (serviceKey 는 ***)`;

if (arg === '--version' || arg === '-v') {
  console.log(pkg.version);
  process.exit(0);
}
if (arg === '--help' || arg === '-h') {
  console.log(HELP);
  process.exit(0);
}

const registry = createRegistry();
const usage = createUsage();

if (arg === 'doctor') {
  const results = await runDoctor({ registry, usage, apply });
  console.log(`datagokr-apply-mcp v${pkg.version} 점검\n`);
  console.log(formatReport(results));
  process.exit(exitCode(results));
}

const server = createServer({ name: 'datagokr-mcp', version: pkg.version });
// DATAGO_DEBUG=1 이면 요청/응답 상태를 stderr 로 남긴다 (serviceKey 는 가림)
const logger = process.env.DATAGO_DEBUG ? (m) => console.error(`[datagokr-mcp] ${m}`) : undefined;
registerTools(server, { registry, usage, logger });
registerApplyTools(server); // 활용신청 자동화(playwright-core 있을 때만)
server.tool('doctor', {
  description: '설치·키·네트워크·브라우저·로그인 세션을 점검해 "왜 안 되는지"와 고치는 방법을 알려준다. '
    + '호출이 실패하거나 apply_* 가 안 보일 때 먼저 실행하라.',
}, async () => {
  const results = await runDoctor({ registry, usage, apply });
  return { content: [{ type: 'text', text: formatReport(results) }] };
});

// stderr 로그만 사용 (stdout 은 프로토콜 전용)
console.error(`[datagokr-mcp] v${pkg.version} 시작 — 도구 ${server.tools.size}개`);
server.listen();
