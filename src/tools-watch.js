// dataset_watch 도구 — 데이터셋 명세 변경 감시 (공개 페이지만 사용, 로그인·키 불필요).
import { fetchApiSpec } from './portal.js';
import { createWatchStore } from './watch.js';

const out = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
const MAX_IDS = 20;

/**
 * @param {any} server
 * @param {import('./types.js').Options} [options]
 */
export function registerWatchTools(server, { fetchImpl, store = createWatchStore() } = {}) {
  server.tool('dataset_watch', {
    description: '데이터셋(오픈API) 명세가 바뀌었는지 감시한다. action: check(기본; ids 를 지금 상태와 저장된 스냅샷으로 비교 — 처음이면 기준선 저장, '
      + '제목·수정일·요청주소·요청변수·응답항목·트래픽 변경을 알려줌), list(감시 중 목록), remove(ids 감시 해제). '
      + '주기적으로 호출해 "내가 쓰는 API 가 바뀌었나?"를 확인할 때 쓴다. 스냅샷에는 공개 명세만 저장되고 키는 저장되지 않는다.',
    inputSchema: { type: 'object', properties: {
      action: { type: 'string', enum: ['check', 'list', 'remove'] },
      ids: { type: 'array', items: { type: 'string' }, description: `데이터 id 또는 URL (최대 ${MAX_IDS}개)` },
    } },
  }, async (a, ctx) => {
    const action = a.action || 'check';
    if (action === 'list') return out({ 감시중: store.list() });
    const ids = [...new Set((a.ids || []).map((x) => String(x).match(/\d{5,}/)?.[0]).filter(Boolean))].slice(0, MAX_IDS);
    if (!ids.length) throw new Error('ids 에 데이터 id(숫자 5자리 이상) 또는 URL 을 넣어주세요.');
    if (action === 'remove') return out({ 해제: ids.map((id) => ({ id, 있었음: store.remove(id) })) });
    if (action !== 'check') throw new Error('action 은 check|list|remove 입니다.');
    const results = [];
    for (let i = 0; i < ids.length; i++) {
      ctx?.signal?.throwIfAborted();
      try {
        const spec = await fetchApiSpec(ids[i], { fetchImpl });
        if (!spec.found) { results.push({ id: ids[i], error: '명세를 읽지 못했어요(LINK형/파일데이터이거나 포털 구조 변경).' }); continue; }
        results.push(store.check(ids[i], spec));
      } catch (e) { results.push({ id: ids[i], error: e.message }); }
      ctx?.progress?.(i + 1, ids.length, `${i + 1}/${ids.length} 확인`);
    }
    return out({
      확인: results.length, 변경됨: results.filter((r) => r.changed).length,
      기준선저장: results.filter((r) => r.baseline).length, 결과: results,
    });
  });
}
