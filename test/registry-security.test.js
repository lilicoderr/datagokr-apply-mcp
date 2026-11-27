import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRegistry } from '../src/registry.js';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'datago-sec-')), 'c.json');
const KEY = 'A'.repeat(40);

test('prototype-polluting names are rejected for keys and endpoints', () => {
  const r = createRegistry(tmp());
  for (const n of ['__proto__', 'constructor', 'prototype', '', 'x'.repeat(65), 'a\u0000b']) {
    assert.throws(() => r.saveKey(n, KEY), /./, n);
    assert.throws(() => r.saveEndpoint(n, 'https://x'), /./, n);
  }
  assert.equal(({}).polluted, undefined);
});

test('getKey of inherited property names returns null', () => {
  const r = createRegistry(tmp());
  r.saveKey('main', KEY);
  assert.equal(r.getKey('toString'), null);
  assert.equal(r.getKey('constructor'), null);
});

test('listKeys never exposes the raw key', () => {
  const r = createRegistry(tmp());
  r.saveKey('main', KEY);
  assert.ok(!JSON.stringify(r.listKeys()).includes(KEY));
});

test('config file is written with owner-only permission (POSIX)', (t) => {
  if (process.platform === 'win32') { t.skip('POSIX 전용'); return; }
  const f = tmp();
  createRegistry(f).saveKey('main', KEY);
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
});
