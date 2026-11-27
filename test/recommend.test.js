import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractKeywords, queryVariants, rankDatasets, recommendDatasets } from '../src/recommend.js';

const html = fs.readFileSync(new URL('./fixtures/search-results.html', import.meta.url), 'utf8');

test('extractKeywords: 조사/불용어 제거', () => {
  assert.deepEqual(extractKeywords('버스 도착 정보를 알려줘'), ['버스', '도착']);
});

test('queryVariants: 중복 제거, 최대 개수', () => {
  const v = queryVariants('서울 버스 도착 시간', 3);
  assert.equal(v.length, 3);
  assert.equal(new Set(v).size, 3);
});

test('rankDatasets: 제목 일치 > 요약 일치 > 인기', () => {
  const items = [
    { id: '1', title: '날씨 예보', summary: '버스', applications: '9999' },
    { id: '2', title: '버스 도착 정보', summary: '', applications: '1' },
  ];
  const r = rankDatasets('버스 도착', items);
  assert.equal(r[0].id, '2');
  assert.deepEqual(r[0].matched, ['버스', '도착']);
});

test('recommendDatasets: 후보 병합 및 실패 변형 무시', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n++;
    if (n === 2) return { ok: false, status: 500, text: async () => '' };
    return { ok: true, status: 200, text: async () => html };
  };
  const r = await recommendDatasets('특일 공휴일', { fetchImpl });
  assert.ok(r.variants.length >= 2);
  assert.ok(r.recommendations.length > 0);
  assert.ok(r.candidates >= r.recommendations.length);
});
