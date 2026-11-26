// 공공데이터 표준 응답에서 "목록 항목"과 페이징 정보를 뽑는다.
//
//   응답 모양이 API마다 제각각이다:
//     JSON: response.body.items.item = [..] | {..}   /  response.body.items = [..]
//     XML : 위와 같되 항목 1개면 배열이 아니라 객체, 0개면 빈 문자열
//   → 항상 배열로 정규화한다.

import { findFirst } from './xml.js';

function toArray(v) {
  if (v == null || v === '') return [];
  return Array.isArray(v) ? v : [v];
}

// 객체 트리에서 key 를 가진 첫 객체의 값 (findFirst 는 원시값만 반환하므로 별도 구현)
function findNode(obj, key) {
  const queue = [obj];
  while (queue.length) {
    const cur = queue.shift();
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
      if (key in cur) return cur[key];
      queue.push(...Object.values(cur));
    } else if (Array.isArray(cur)) {
      queue.push(...cur);
    }
  }
  return undefined;
}

export function extractItems(data) {
  if (data == null || typeof data !== 'object') return { items: [], totalCount: null, pageNo: null, numOfRows: null };
  const itemsNode = findNode(data, 'items');
  let items = [];
  if (Array.isArray(itemsNode)) items = itemsNode;
  else if (itemsNode && typeof itemsNode === 'object') items = toArray(itemsNode.item ?? itemsNode.row ?? []);
  else if (data?.response?.body?.item) items = toArray(data.response.body.item);

  const num = (k) => { const v = findFirst(data, [k]); return v == null || v === '' ? null : Number(v); };
  return { items, totalCount: num('totalCount'), pageNo: num('pageNo'), numOfRows: num('numOfRows') };
}

// 다음 페이지가 더 있는지
export function hasMore({ totalCount, pageNo, numOfRows, items }) {
  if (totalCount == null) return items.length > 0 && numOfRows != null && items.length >= numOfRows;
  return (pageNo ?? 1) * (numOfRows ?? items.length) < totalCount;
}
