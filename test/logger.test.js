import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, redact, redactString, loggerFromEnv } from '../src/logger.js';

const KEY = 'AbCdEf0123456789SeCrEtKeyValue%2Bxyz==';

test('redactString: serviceKey 쿼리/JSON, Authorization, Cookie', () => {
  assert.equal(redactString(`GET /a?x=1&serviceKey=${KEY}&y=2`), 'GET /a?x=1&serviceKey=***&y=2');
  assert.ok(!redactString(`{"serviceKey":"${KEY}"}`).includes('SeCrEt'));
  assert.ok(!redactString('Authorization: Bearer abc.def.ghi').includes('abc.def'));
  assert.ok(!redactString('Cookie: JSESSIONID=zzzzzz; a=b').includes('zzzzzz'));
});

test('redactString: 등록된 비밀 원문 치환 (짧은 값은 무시)', () => {
  assert.equal(redactString(`oops ${KEY} oops`, [KEY]), 'oops *** oops');
  assert.equal(redactString('abc def', ['abc']), 'abc def');
});

test('redact: 민감 필드명 마스킹, 중첩/배열', () => {
  const r = redact({ a: 1, serviceKey: KEY, nested: { Cookie: 'x', list: [{ token: 't' }, `k=${KEY}`] } }, [KEY]);
  assert.equal(r.serviceKey, '***');
  assert.equal(r.nested.Cookie, '***');
  assert.equal(r.nested.list[0].token, '***');
  assert.ok(!JSON.stringify(r).includes('SeCrEt'));
});

test('logger: 레벨 필터, JSON 한 줄, 로그에 키가 남지 않음', () => {
  const lines = [];
  const log = createLogger({ level: 'info', write: (l) => lines.push(l), secrets: () => [KEY], now: () => new Date(0) });
  log.debug('hidden');
  log.info(`calling ?serviceKey=${KEY}`, { url: `http://h/?serviceKey=${KEY}`, serviceKey: KEY, ms: 5 });
  log(`debug via fn ${KEY}`); // debug 레벨이라 info 설정에선 출력 안 됨
  assert.equal(lines.length, 1);
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.level, 'info');
  assert.equal(rec.ts, '1970-01-01T00:00:00.000Z');
  assert.equal(rec.ms, 5);
  assert.ok(!lines[0].includes('SeCrEt'));
});

test('loggerFromEnv: 기본 off, DATAGO_DEBUG 는 debug', () => {
  const lines = [];
  const off = loggerFromEnv({}, { write: (l) => lines.push(l) });
  off.error('x');
  assert.equal(lines.length, 0);
  const dbg = loggerFromEnv({ DATAGO_DEBUG: '1' }, { write: (l) => lines.push(l) });
  dbg('hello');
  assert.equal(lines.length, 1);
});
