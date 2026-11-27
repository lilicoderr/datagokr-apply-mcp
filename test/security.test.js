import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeTarget, isPrivateHost } from '../src/security.js';

const ok = (u, env = {}) => assert.doesNotThrow(() => assertSafeTarget(u, env), u);
const bad = (u, env = {}) => assert.throws(() => assertSafeTarget(u, env), /./, u);

test('allows normal public API URLs', () => {
  ok('https://apis.data.go.kr/B090041/x?pageNo=1');
  ok('http://openapi.seoul.go.kr:8088/key/json/x/1/5');
});

test('blocks non-http schemes and embedded credentials', () => {
  bad('file:///etc/passwd');
  bad('ftp://example.com/x');
  bad('javascript:alert(1)');
  bad('https://user:pw@apis.data.go.kr/x');
  bad('not a url');
});

test('blocks loopback / private / metadata hosts by default', () => {
  for (const h of ['http://localhost:3000', 'http://127.0.0.1/', 'http://10.0.0.5/', 'http://192.168.1.1/',
    'http://172.20.0.1/', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/',
    'http://[fd00::1]/', 'http://svc.internal/']) bad(h);
  assert.equal(isPrivateHost('172.32.0.1'), false);
  assert.equal(isPrivateHost('8.8.8.8'), false);
});

test('DATAGO_ALLOW_LOCAL=1 permits local hosts', () => {
  ok('http://127.0.0.1:8080/x', { DATAGO_ALLOW_LOCAL: '1' });
});

test('DATAGO_ALLOWED_HOSTS restricts to listed domains and subdomains', () => {
  const env = { DATAGO_ALLOWED_HOSTS: 'data.go.kr, seoul.go.kr' };
  ok('https://apis.data.go.kr/x', env);
  ok('https://openapi.seoul.go.kr/x', env);
  bad('https://evil.example.com/x', env);
  bad('https://data.go.kr.evil.com/x', env);
});

import { assertSafeTargetResolved, isDefaultAllowedHost } from '../src/security.js';

test('default allowlist: data.go.kr, *.go.kr, *.or.kr only', () => {
  assert.equal(isDefaultAllowedHost('apis.data.go.kr'), true);
  assert.equal(isDefaultAllowedHost('openapi.seoul.go.kr'), true);
  assert.equal(isDefaultAllowedHost('kosis.or.kr'), true);
  bad('https://evil.example.com/x');
  bad('https://data.go.kr.evil.com/x');
  ok('https://evil.example.com/x', { DATAGO_ALLOWED_HOSTS: 'example.com' });
});

test('DNS resolution: any private address rejects the call', async () => {
  const pub = async () => [{ address: '203.0.113.5', family: 4 }];
  const mixed = async () => [{ address: '203.0.113.5', family: 4 }, { address: '10.0.0.8', family: 4 }];
  const loop6 = async () => [{ address: '::1', family: 6 }];
  await assert.doesNotReject(assertSafeTargetResolved('https://apis.data.go.kr/x', {}, pub));
  await assert.rejects(assertSafeTargetResolved('https://apis.data.go.kr/x', {}, mixed), /내부\/로컬/);
  await assert.rejects(assertSafeTargetResolved('https://apis.data.go.kr/x', {}, loop6), /내부\/로컬/);
  await assert.doesNotReject(assertSafeTargetResolved('http://127.0.0.1/x', { DATAGO_ALLOW_LOCAL: '1' }, mixed));
});

test('DNS resolution: IPv6 literal brackets are stripped and the literal is not looked up', async () => {
  const never = async () => { throw new Error('lookup must not run for IP literals'); };
  await assert.doesNotReject(assertSafeTargetResolved('https://[2001:db8::1]/x', { DATAGO_ALLOWED_HOSTS: '[2001:db8::1]' }, never));
});
