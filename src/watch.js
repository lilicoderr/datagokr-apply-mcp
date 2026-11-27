// 데이터셋 변경 감시 — 명세(메타데이터) 스냅샷을 저장해 두고, 다시 가져와 달라진 점을 알려 준다.
//   저장 위치: DATAGO_WATCH (기본 ~/.datago-watch.json). 키·쿠키 등 비밀은 저장하지 않는다(공개 명세만).
//   변동이 잦은 값(활용신청 수 등)은 비교에서 제외해 잡음을 줄인다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function defaultWatchPath() {
  return process.env.DATAGO_WATCH || path.join(os.homedir(), '.datago-watch.json');
}

const names = (list) => (Array.isArray(list) ? list.map((x) => x.name).filter(Boolean).sort() : []);

// spec(fetchApiSpec 결과) -> 비교용 지문. 순서·잡음에 둔감하도록 정렬한다.
export function fingerprint(spec) {
  const fields = {
    title: spec.title ?? null,
    provider: spec.provider ?? null,
    updated: spec.updated ?? null,
    format: spec.format ?? null,
    traffic: spec.traffic ?? null,
    approval: spec.approval ?? null,
    endpoint: spec.endpoint ?? null,
    operations: names(spec.operations),
    request: (spec.request || []).map((r) => `${r.name}${r.required ? '*' : ''}`).sort(),
    response: names(spec.response),
  };
  const hash = createHash('sha256').update(JSON.stringify(fields)).digest('hex').slice(0, 16);
  return { hash, fields };
}

const asSet = (v) => new Set(Array.isArray(v) ? v : []);

// 이전/현재 지문의 차이를 사람이 읽을 목록으로
export function diffFingerprints(prev, next) {
  if (prev.hash === next.hash) return [];
  const out = [];
  for (const [k, nv] of Object.entries(next.fields)) {
    const pv = prev.fields?.[k];
    if (Array.isArray(nv)) {
      const a = asSet(pv); const b = asSet(nv);
      const added = [...b].filter((x) => !a.has(x)); const removed = [...a].filter((x) => !b.has(x));
      if (added.length || removed.length) out.push({ field: k, added, removed });
    } else if (pv !== nv) {
      out.push({ field: k, from: pv ?? null, to: nv });
    }
  }
  return out;
}

export function createWatchStore(file = defaultWatchPath(), { now = () => new Date() } = {}) {
  const load = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { datasets: {} }; } };
  const save = (state) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);
  };
  return {
    file,
    list() { return Object.entries(load().datasets).map(([id, d]) => ({ id, title: d.title, checkedAt: d.checkedAt, changedAt: d.changedAt })); },
    remove(id) { const s = load(); const had = id in s.datasets; delete s.datasets[id]; if (had) save(s); return had; },
    // 스냅샷과 비교하고 갱신한다. 처음이면 baseline 으로 저장(변경 없음으로 취급).
    check(id, spec) {
      const s = load();
      const fp = fingerprint(spec);
      const at = now().toISOString();
      const prev = s.datasets[id];
      const changes = prev ? diffFingerprints(prev, fp) : [];
      s.datasets[id] = {
        title: spec.title || prev?.title || id, hash: fp.hash, fields: fp.fields,
        checkedAt: at, changedAt: changes.length ? at : (prev?.changedAt ?? null),
      };
      save(s);
      return { id, title: s.datasets[id].title, baseline: !prev, changed: changes.length > 0, changes, checkedAt: at };
    },
  };
}
