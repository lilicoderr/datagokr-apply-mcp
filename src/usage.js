// 로컬 호출량 집계 — 개발계정 일일 트래픽(보통 1,000회) 한도 초과(resultCode 22)를 미리 피하기 위한 것.
//
//   포털은 남은 트래픽을 알려주지 않으므로, 이 서버를 통해 한 호출만 센다(추정치).
//   기본 경로: $DATAGO_USAGE, 없으면 ~/.datago-usage.json. 키 값은 저장하지 않고 키 "이름"만 쓴다.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_DAILY_LIMIT = 1000;

export function defaultUsagePath() {
  return process.env.DATAGO_USAGE || path.join(os.homedir(), '.datago-usage.json');
}

// 한국 표준시(UTC+9) 기준 날짜 — 포털 트래픽이 자정(KST)에 초기화되므로
export function kstDate(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function createUsage(file = defaultUsagePath(), { now = () => new Date(), keep = 14 } = {}) {
  function load() {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  }
  function save(state) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf8');
    } catch { /* 집계 실패가 API 호출을 막으면 안 된다 */ }
  }

  return {
    file,
    record(keyName = 'direct', { ok = true } = {}) {
      const s = load();
      const day = kstDate(now());
      s[day] ??= {};
      const row = (s[day][keyName] ??= { calls: 0, failed: 0 });
      row.calls += 1;
      if (!ok) row.failed += 1;
      // 오래된 날짜 정리
      const days = Object.keys(s).sort();
      for (const d of days.slice(0, Math.max(0, days.length - keep))) delete s[d];
      save(s);
      return row;
    },
    today() {
      return load()[kstDate(now())] || {};
    },
    // { day, limit, byKey: {name: {calls, failed, remaining, warn}}, total }
    summary({ limit = DEFAULT_DAILY_LIMIT } = {}) {
      const byKey = {};
      let total = 0;
      for (const [name, row] of Object.entries(this.today())) {
        const remaining = Math.max(0, limit - row.calls);
        byKey[name] = { ...row, remaining, warn: row.calls >= limit * 0.8 };
        total += row.calls;
      }
      return { day: kstDate(now()), limit, total, byKey };
    },
  };
}
