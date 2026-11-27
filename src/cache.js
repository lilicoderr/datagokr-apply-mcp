// 메모리 응답 캐시 (TTL + 최대 개수). 같은 호출을 반복해 일일 트래픽을 낭비하지 않기 위한 것.
//
//   키: 요청 URL + 정렬된 params + 키 "이름"(키 값은 캐시 키에 넣지 않는다).
//   성공(ok) 응답만 저장한다.

export function cacheKey(url, params = {}, keyName = '') {
  const sorted = Object.keys(params).sort().map((k) => [k, params[k]]);
  return JSON.stringify([url, sorted, keyName]);
}

export function createCache({ max = 200, now = () => Date.now() } = {}) {
  const store = new Map(); // key → { value, expires }
  let hits = 0;
  let misses = 0;

  return {
    get(key) {
      const e = store.get(key);
      if (!e) { misses++; return undefined; }
      if (e.expires <= now()) { store.delete(key); misses++; return undefined; }
      store.delete(key); store.set(key, e); // LRU: 최근 사용으로 이동
      hits++;
      return e.value;
    },
    set(key, value, ttlMs) {
      if (!(ttlMs > 0)) return;
      store.delete(key);
      store.set(key, { value, expires: now() + ttlMs });
      while (store.size > max) store.delete(store.keys().next().value);
    },
    clear() { store.clear(); },
    stats() { return { size: store.size, hits, misses }; },
  };
}
