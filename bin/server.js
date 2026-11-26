#!/usr/bin/env node
// 공공데이터포털 MCP 서버 엔트리 — stdio 로 MCP 클라이언트(Claude 등)와 통신.
import { createServer } from '../src/mcp.js';
import { createRegistry } from '../src/registry.js';
import { registerTools } from '../src/tools.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const server = createServer({ name: 'data-go-mcp', version: pkg.version });
registerTools(server, { registry: createRegistry() });

// stderr 로그만 사용 (stdout 은 프로토콜 전용)
console.error(`[data-go-mcp] v${pkg.version} 시작 — 도구 ${server.tools.size}개`);
server.listen();
