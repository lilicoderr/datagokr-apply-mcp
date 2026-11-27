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

// 객체 키로 쓰이는 이름 검증 (__proto__ 등으로 프로토타입을 오염시키지 못하게)
export function assertSafeName(name, what = '이름') {
  const n = String(name ?? '');
  if (!n || n.length > 64 || /[\x00-\x1f]/.test(n)) throw new Error(`${what}은(는) 1~64자, 제어문자 없이 입력하세요.`);
  if (['__proto__', 'prototype', 'constructor'].includes(n)) throw new Error(`${what} '${n}' 은(는) 사용할 수 없어요.`);
  return n;
}

const BLANK = { keys: {}, defaultKey: null, endpoints: {} };

export function createRegistry(file = defaultConfigPath()) {
  function load() {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      return structuredClone(BLANK); // 파일 없음 = 첫 사용
    }
    try {
      const obj = JSON.parse(raw);
      return {
        keys: obj.keys && typeof obj.keys === 'object' ? obj.keys : {},
        defaultKey: obj.defaultKey || null,
        endpoints: obj.endpoints && typeof obj.endpoints === 'object' ? obj.endpoints : {},
      };
    } catch (e) {
      // 손상된 파일을 빈 상태로 덮어쓰면 저장된 키가 전부 사라진다 → 백업 후 진행
      const bak = `${file}.corrupt-${Date.now()}.bak`;
      try { fs.copyFileSync(file, bak); fs.chmodSync(bak, 0o600); } catch { /* 백업 실패해도 계속 */ }
      console.error(`[datagokr-mcp] 설정 파일이 손상돼 백업했어요: ${bak} (${e.message})`);
      return structuredClone(BLANK);
    }
  }

  // 임시 파일에 쓰고 rename → 쓰는 도중 종료돼도 기존 파일이 깨지지 않음. 키 파일은 본인만 읽도록(0600).
  function save(state) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  return {
    file,
    // 설정 파일이 없으면 빈 상태로 만든다 (doctor --fix). 이미 있으면 아무것도 하지 않는다.
    init() {
      if (fs.existsSync(file)) return false;
      save(structuredClone(BLANK));
      return true;
    },
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
      const pick = name || s.defaultKey;
      const key = pick && Object.hasOwn(s.keys, pick) ? s.keys[pick] : null;
      return key ? key.key : null;
    },
    saveKey(name, key, note = '') {
      if (!name || !key) throw new Error('name 과 key 가 필요합니다.');
      assertSafeName(name, '키 이름');
      const cleaned = String(key).trim();
      if (/\s/.test(cleaned)) throw new Error('키 중간에 공백/줄바꿈이 있어요. 포털에서 복사할 때 섞여 들어간 것 같으니 다시 확인하세요.');
      if (cleaned.length < 16) throw new Error(`키가 너무 짧아요(${cleaned.length}자). 포털 개발계정의 "일반 인증키"는 보통 64자 안팎이에요.`);
      const s = load();
      s.keys[name] = { key: cleaned, note: String(note) };
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
    getEndpoint(alias) { const e = load().endpoints; return Object.hasOwn(e, alias) ? e[alias] : null; },
    saveEndpoint(alias, url, note = '', params = {}, required = undefined) {
      if (!alias || !url) throw new Error('alias 와 url 이 필요합니다.');
      assertSafeName(alias, '별칭');
      const s = load();
      s.endpoints[alias] = { url: String(url), note: String(note), params: params || {},
        ...(Array.isArray(required) ? { required: required.map(String) } : {}) }; // describe_api 가 저장한 필수 변수(호출 전 검증용)
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
