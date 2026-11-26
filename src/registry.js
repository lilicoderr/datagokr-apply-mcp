// 서비스키 · 자주 쓰는 엔드포인트를 로컬 파일에 저장/관리
//
//   기본 경로: $DATAGO_CONFIG, 없으면 ~/.datago-mcp.json
//   키는 민감정보이므로 저장소(.gitignore)에만 두고 커밋하지 않는다.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function defaultConfigPath() {
  return process.env.DATAGO_CONFIG || path.join(os.homedir(), '.datago-mcp.json');
}

const BLANK = { keys: {}, defaultKey: null, endpoints: {} };

export function createRegistry(file = defaultConfigPath()) {
  function load() {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const obj = JSON.parse(raw);
      return {
        keys: obj.keys && typeof obj.keys === 'object' ? obj.keys : {},
        defaultKey: obj.defaultKey || null,
        endpoints: obj.endpoints && typeof obj.endpoints === 'object' ? obj.endpoints : {},
      };
    } catch {
      return structuredClone(BLANK);
    }
  }

  function save(state) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf8');
  }

  return {
    file,
    // ── 서비스 키 ──
    listKeys() {
      const s = load();
      // 키 값은 마스킹해서 노출
      return {
        defaultKey: s.defaultKey,
        keys: Object.fromEntries(Object.entries(s.keys).map(([name, v]) => [name, {
          masked: maskKey(v.key), encoded: /%[0-9A-Fa-f]{2}/.test(v.key), note: v.note || '',
        }])),
      };
    },
    getKey(name) {
      const s = load();
      const key = name ? s.keys[name] : (s.defaultKey ? s.keys[s.defaultKey] : null);
      return key ? key.key : null;
    },
    saveKey(name, key, note = '') {
      if (!name || !key) throw new Error('name 과 key 가 필요합니다.');
      const s = load();
      s.keys[name] = { key: String(key), note: String(note) };
      if (!s.defaultKey) s.defaultKey = name;
      save(s);
      return { name, isDefault: s.defaultKey === name };
    },
    removeKey(name) {
      const s = load();
      if (!s.keys[name]) return false;
      delete s.keys[name];
      if (s.defaultKey === name) s.defaultKey = Object.keys(s.keys)[0] || null;
      save(s);
      return true;
    },
    setDefaultKey(name) {
      const s = load();
      if (!s.keys[name]) throw new Error(`키 '${name}' 가 없습니다.`);
      s.defaultKey = name;
      save(s);
      return name;
    },
    // ── 엔드포인트(별칭) ──
    listEndpoints() { return load().endpoints; },
    getEndpoint(alias) { return load().endpoints[alias] || null; },
    saveEndpoint(alias, url, note = '', params = {}) {
      if (!alias || !url) throw new Error('alias 와 url 이 필요합니다.');
      const s = load();
      s.endpoints[alias] = { url: String(url), note: String(note), params: params || {} };
      save(s);
      return alias;
    },
    removeEndpoint(alias) {
      const s = load();
      if (!s.endpoints[alias]) return false;
      delete s.endpoints[alias];
      save(s);
      return true;
    },
  };
}

export function maskKey(key) {
  const s = String(key || '');
  if (s.length <= 8) return '*'.repeat(s.length);
  return s.slice(0, 4) + '…' + s.slice(-4) + ` (${s.length}자)`;
}
