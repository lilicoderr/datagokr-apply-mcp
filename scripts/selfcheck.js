#!/usr/bin/env node
// npm run selfcheck — 설치 가이드 검증 (서버 stdio/HTTP 기동, 폴더 권한, Node 버전)
import { runSelfcheck } from '../src/selfcheck.js';

process.exit(await runSelfcheck());
