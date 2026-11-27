import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildErrorCatalog } from '../src/errorcatalog.js';
import { RESULT_CODES } from '../src/datago.js';

test('error catalog lists every resultCode', () => {
  const md = buildErrorCatalog();
  for (const c of Object.keys(RESULT_CODES)) assert.ok(md.includes(`| \`${c}\` |`), c);
});

test('docs/error-catalog.md is up to date (run: npm run docs:errors)', () => {
  const file = fs.readFileSync(new URL('../docs/error-catalog.md', import.meta.url), 'utf8');
  assert.equal(file.replace(/\r\n/g, '\n'), buildErrorCatalog());
});
