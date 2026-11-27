import test from 'node:test';
import assert from 'node:assert/strict';
import { kindOf, inferSchema } from '../src/schema.js';

test('kindOf', () => {
  assert.equal(kindOf('20240101'), 'date(yyyymmdd)');
  assert.equal(kindOf('20241301'), 'integer-string');
  assert.equal(kindOf('2024-01-02 10:00'), 'date');
  assert.equal(kindOf('007'), 'string');
  assert.equal(kindOf('3.5'), 'number-string');
  assert.equal(kindOf(''), 'empty');
  assert.equal(kindOf(3), 'integer');
});

test('inferSchema: 결측률, 혼합 타입, enum', () => {
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push({ id: String(i), kind: i % 2 ? 'A' : 'B', d: '20240101', opt: i < 4 ? 'x' : '' });
  rows.push({ id: 'zz', kind: 'A', d: '20240102' });
  const s = inferSchema(rows);
  assert.equal(s.sampleSize, 11);
  assert.equal(s.fields.id.type, 'integer-string|string');
  assert.equal(s.fields.d.type, 'date(yyyymmdd)');
  assert.equal(s.fields.d.nullable, false);
  assert.deepEqual(s.fields.kind.enum.sort(), ['A', 'B']);
  assert.equal(s.fields.opt.nullable, true);
  assert.ok(s.fields.opt.missingRate > 0.6);
});
