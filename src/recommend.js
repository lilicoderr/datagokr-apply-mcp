// 자연어 질의 → 데이터셋 추천. 포털 검색을 질의 변형별로 돌린 뒤 점수로 재정렬한다.

import { searchDatasets } from './portal.js';

const STOP = new Set(['을', '를', '이', '가', '은', '는', '의', '에', '에서', '좀', '그', '데이터', '정보', '조회', '알려줘', '찾아줘', '보여줘', 'api', 'the', 'a', 'of', 'for', 'and', 'to']);
const JOSA = /(을|를|이|가|은|는|의|에서|에|로|으로|와|과|도|만)$/;

export function extractKeywords(query) {
  const words = String(query || '').toLowerCase().split(/[\s,.;!?()/]+/)
    .map((w) => (w.length > 2 ? w.replace(JOSA, '') : w))
    .filter((w) => w && !STOP.has(w));
  return [...new Set(words)];
}

// 검색 질의 후보: 전체 문장 → 키워드 전부 → 키워드 앞 2개 → 각각
export function queryVariants(query, max = 4) {
  const kw = extractKeywords(query);
  const out = [kw.join(' '), kw.slice(0, 2).join(' '), ...kw].filter(Boolean);
  if (!out.length && String(query || '').trim()) out.push(String(query).trim());
  return [...new Set(out)].slice(0, max);
}

const num = (s) => Number(String(s ?? '').replace(/[^\d]/g, '')) || 0;

export function scoreItem(item, keywords) {
  const title = String(item.title || '').toLowerCase();
  const rest = `${item.summary || ''} ${item.category || ''} ${item.provider || ''}`.toLowerCase();
  let score = 0;
  const matched = [];
  for (const k of keywords) {
    if (title.includes(k)) { score += 3; matched.push(k); } else if (rest.includes(k)) { score += 1; matched.push(k); }
  }
  score += Math.min(Math.log10(1 + num(item.applications)), 4) * 0.5; // 인기(활용신청 수) 가산
  if (/json/i.test(item.format || '')) score += 0.3;
  return { score: Math.round(score * 100) / 100, matched };
}

export function rankDatasets(query, items, limit = 5) {
  const keywords = extractKeywords(query);
  return items
    .map((it) => ({ ...it, ...scoreItem(it, keywords) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function recommendDatasets(query, { limit = 5, fetchImpl } = {}) {
  const variants = queryVariants(query);
  const seen = new Map();
  for (const q of variants) {
    try {
      const r = await searchDatasets(q, { fetchImpl });
      for (const it of r.items) if (!seen.has(it.id)) seen.set(it.id, it);
    } catch { /* 한 변형 실패는 무시 */ }
  }
  return { variants, candidates: seen.size, recommendations: rankDatasets(query, [...seen.values()], limit) };
}
