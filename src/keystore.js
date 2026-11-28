// 마이페이지 인증키를 읽어 검증하고 저장한다 (apply_api / apply_get_key / use_api 공용). 기존 키는 덮어쓰지 않는다.
import { maskSecret, validateServiceKeys } from './keyextract.js';

// 같은 이름에 다른 키가 이미 있으면 덮어쓰지 않고 name-2, name-3 … 로 저장할 자리를 고른다.
const sameKey = (a, b) => { try { return decodeURIComponent(a) === decodeURIComponent(b); } catch { return a === b; } };
function pickKeySlot(registry, name, keys) {
  for (let i = 1; i < 100; i++) {
    const n = i === 1 ? name : `${name}-${i}`;
    const cur = registry.getKey(n);
    if (!cur) return { name: n, same: false };
    if (sameKey(cur, keys.decoding)) return { name: n, same: true };
  }
  return { name: `${name}-${Date.now()}`, same: false };
}

/** @param {any} apply @param {any} registry */
export function createKeyRetriever(apply, registry) {
  // 인증키를 읽어 저장한다. 원문은 반환·로그하지 않고 마스킹 값만 돌려준다.
  async function retrieveKey({ headless = true, keyName = undefined } = {}) {
    const name = keyName || 'datago';
    try {
      const r = await apply.fetchServiceKey({ headless });
      if (!r.ok) {
        return { ok: false, saved: false, needLogin: Boolean(r.needLogin), message: `${r.message} 자동으로 못 읽으면 마이페이지 > 오픈API > 개발계정에서 일반 인증키를 복사해 save_key 로 저장하세요.`,
          hint: r.needLogin ? 'Not logged in; run apply_login then apply_status.' : 'Automatic key retrieval failed (unverified against the live portal); copy the key manually and use save_key.',
          next: r.needLogin ? 'apply_login' : 'save_key { name, key }' };
      }
      const v = validateServiceKeys(r.keys);
      if (!v.ok) {
        return { ok: false, saved: false, message: `읽은 값이 인증키가 맞는지 확인하지 못해 저장하지 않았어요 (${v.reason}). 마이페이지 > 개발계정에서 일반 인증키를 직접 복사해 save_key 로 저장하세요.`,
          hint: 'Scraped value did not validate as a service key; not saved. Use save_key manually.', next: 'save_key { name, key }' };
      }
      const raw = r.keys.encoding;
      const masked = maskSecret(raw);
      if (!registry) {
        return { ok: true, saved: false, masked, message: `인증키를 읽었지만 저장소가 없어 저장하지 못했어요 (${masked}).`, hint: 'No registry configured; key not persisted.' };
      }
      const slot = pickKeySlot(registry, name, r.keys);
      if (slot.same) {
        return { ok: true, saved: false, keyName: slot.name, masked, message: `같은 키가 '${slot.name}' 이름으로 이미 저장돼 있어요 (${masked}).`, hint: 'Key already stored; nothing to do.', next: 'call_api' };
      }
      registry.saveKey(slot.name, raw, '활용신청 자동 발급(마이페이지 일반 인증키)');
      const moved = slot.name !== name
        ? ` 기존 '${name}' 키(${maskSecret(registry.getKey(name))})는 값이 달라 덮어쓰지 않았어요.` : '';
      return { ok: true, saved: true, keyName: slot.name, masked,
        message: `인증키를 읽어 '${slot.name}' 이름으로 저장했어요 (${masked}).${moved} 이제 call_api 로 호출할 수 있어요.`, hint: 'Key saved.', next: 'call_api { url, params }' };
    } catch (e) {
      return { ok: false, saved: false, message: `인증키 읽기 실패: ${String(e?.message || e).split(String.fromCharCode(10))[0]}. 마이페이지에서 키를 복사해 save_key 로 저장할 수도 있어요.`,
        hint: 'Key retrieval threw; run doctor, or copy the key manually and use save_key.', next: 'doctor' };
    }
  }
  return retrieveKey;
}
