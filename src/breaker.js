// 호스트별 서킷 브레이커. 연속 실패가 임계치를 넘으면 잠시 호출을 차단(fail-fast)해
// 죽은 서버에 재시도/타임아웃으로 시간을 낭비하지 않는다. closed → open → half-open → closed.

export function createBreaker({ threshold = 5, cooldownMs = 30000, now = () => Date.now() } = {}) {
  const hosts = new Map(); // host -> { fails, openedAt, probing }

  const hostOf = (url) => { try { return new URL(url).host; } catch { return String(url); } };
  const st = (h) => { if (!hosts.has(h)) hosts.set(h, { fails: 0, openedAt: 0, probing: false }); return hosts.get(h); };

  return {
    // 호출 전: 차단 중이면 남은 대기(ms)를 돌려주고, 아니면 0
    check(url) {
      const s = st(hostOf(url));
      if (s.fails < threshold) return 0;
      const wait = s.openedAt + cooldownMs - now();
      if (wait > 0) return wait;
      if (s.probing) return cooldownMs; // half-open: 시험 호출 1건만 허용
      s.probing = true;
      return 0;
    },
    success(url) { hosts.set(hostOf(url), { fails: 0, openedAt: 0, probing: false }); },
    failure(url) {
      const s = st(hostOf(url));
      s.fails++;
      s.probing = false;
      if (s.fails >= threshold) s.openedAt = now();
    },
    state(url) {
      const s = st(hostOf(url));
      if (s.fails < threshold) return 'closed';
      return s.openedAt + cooldownMs > now() ? 'open' : 'half-open';
    },
    snapshot() {
      return Object.fromEntries([...hosts].map(([h, s]) => [h, { fails: s.fails, state: this.state(`http://${h}`) }]));
    },
  };
}

export class CircuitOpenError extends Error {
  constructor(host, waitMs) {
    super(`${host} 호출을 잠시 차단했어요(연속 실패). 약 ${Math.ceil(waitMs / 1000)}초 뒤 다시 시도하세요.`);
    this.name = 'CircuitOpenError';
    this.waitMs = waitMs;
  }
}
