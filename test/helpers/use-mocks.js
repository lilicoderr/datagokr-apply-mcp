// use_api 단위 테스트용 가짜들 (브라우저·네트워크 없음). 키는 전부 가짜 값.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRegistry } from '../../src/registry.js';
import { createUse } from '../../src/tools-use.js';

export const DEC = 'FAKEFAKEFAKEfakeKEY+EXAMPLE/NOTAREALKEY0123456789abcdefghij==';
export const ENC = encodeURIComponent(DEC);
export const OLD = 'OLDKEYOLDKEYOLDKEYOLDKEYOLDKEYOLDKEYOLDKEY0123456789';
export const ENDPOINT = 'https://apis.data.go.kr/FAKE/getThing';

const row = (name, need, sample) => `<tr><td>이름</td><td>${name}</td><td>4</td><td>${need}</td><td>${sample}</td><td>설명</td></tr>`;
const info = (k, v) => `<strong class="key">${k}</strong><div class="value">${v}</div>`;

export function setup({ sample = '2019', loggedIn = true, available = true, applyResult, keyResult } = {}) {
  const world = { code: '30', calls: [], applied: [], retrieved: 0, loggedIn, clock: Date.parse('2030-01-01T00:00:00Z') };
  const spec = `<title>가짜 서비스 | 포털</title>${info('API 유형', 'REST')}${info('요청주소', ENDPOINT)}${info('활용승인 절차', '개발단계 : 자동승인')}<table class="data">${row('solYear', '필', sample)}</table>`;
  const fetchImpl = async (url) => {
    const isSpec = url.startsWith('https://www.data.go.kr/');
    if (!isSpec) world.calls.push(url);
    const body = isSpec ? spec : JSON.stringify({ response: { header: { resultCode: world.code }, body: { totalCount: 1, items: { item: [{ a: 1 }] } } } });
    return { ok: true, status: 200, headers: { get: () => (isSpec ? 'text/html' : 'application/json') }, text: async () => body };
  };
  const apply = {
    isAvailable: () => available,
    checkLogin: async () => ({ loggedIn: world.loggedIn }),
    applyForApis: async (ids, opts) => {
      world.applied.push({ ids, ...opts });
      return applyResult || { done: 1, already: 0, failed: 0, needLogin: false, results: [{ idOrUrl: ids[0], ok: true }] };
    },
    fetchServiceKey: async () => {
      world.retrieved += 1;
      return keyResult || { ok: true, keys: { encoding: ENC, decoding: DEC }, message: 'ok' };
    },
  };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'datago-use-')), 'c.json');
  const registry = createRegistry(file);
  const deps = { registry, apply, fetchImpl, sleep: async () => {}, now: () => world.clock };
  return { world, registry, apply, deps, file, use: createUse(deps) };
}
