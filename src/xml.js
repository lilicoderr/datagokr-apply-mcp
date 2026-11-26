// 아주 작은 XML → JS 객체 파서 (공공데이터포털 XML 응답용, 의존성 없음)
//
//   · 요소/텍스트/CDATA/주석/XML 선언 처리
//   · 같은 이름의 형제 요소가 여러 개면 배열로
//   · 속성은 "@attr" 키로 (거의 안 쓰이지만 보존)
//   · 순수 텍스트만 있는 요소는 문자열로 축약
//
//   완전한 XML 스펙 구현이 아니라, data.go.kr 응답을 다루기 위한 실용 파서입니다.

export function parseXml(xml) {
  const src = String(xml);
  let i = 0;

  function skipMisc() {
    for (;;) {
      if (src.startsWith('<?', i)) { i = src.indexOf('?>', i); i = i < 0 ? src.length : i + 2; }
      else if (src.startsWith('<!--', i)) { i = src.indexOf('-->', i); i = i < 0 ? src.length : i + 3; }
      else if (src.startsWith('<!', i)) { i = src.indexOf('>', i); i = i < 0 ? src.length : i + 1; } // DOCTYPE 등
      else if (/\s/.test(src[i])) { i++; }
      else break;
    }
  }

  function parseNode() {
    skipMisc();
    if (src[i] !== '<') return null;
    i++; // '<'
    // 태그명
    const nameMatch = /^[^\s/>]+/.exec(src.slice(i));
    if (!nameMatch) throw new Error(`XML 파싱 오류: 태그명 (pos ${i})`);
    const tag = nameMatch[0];
    i += tag.length;

    // 속성
    const attrs = {};
    for (;;) {
      while (/\s/.test(src[i])) i++;
      if (src[i] === '/' && src[i + 1] === '>') { i += 2; return { tag, attrs, children: [], text: '' }; }
      if (src[i] === '>') { i++; break; }
      const am = /^([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/.exec(src.slice(i));
      if (!am) { // 잘못된 속성은 건너뜀
        const gt = src.indexOf('>', i);
        if (gt < 0) throw new Error('XML 파싱 오류: 닫는 >');
        i = gt + 1; break;
      }
      attrs[am[1]] = am[3] ?? am[4] ?? '';
      i += am[0].length;
    }

    // 자식/텍스트
    const children = [];
    let text = '';
    for (;;) {
      if (i >= src.length) break;
      if (src.startsWith('</', i)) {
        const end = src.indexOf('>', i);
        i = end < 0 ? src.length : end + 1;
        break;
      }
      if (src.startsWith('<![CDATA[', i)) {
        const end = src.indexOf(']]>', i);
        text += src.slice(i + 9, end < 0 ? src.length : end);
        i = end < 0 ? src.length : end + 3;
        continue;
      }
      if (src.startsWith('<!--', i)) { const e = src.indexOf('-->', i); i = e < 0 ? src.length : e + 3; continue; }
      if (src[i] === '<') { const child = parseNode(); if (child) children.push(child); continue; }
      const next = src.indexOf('<', i);
      text += src.slice(i, next < 0 ? src.length : next);
      i = next < 0 ? src.length : next;
    }
    return { tag, attrs, children, text: text.trim() };
  }

  // 한 번에 치환해야 "&amp;lt;" 가 "<" 로 이중 디코딩되지 않는다. 숫자 참조(&#65; &#xAC00;)도 처리.
  const NAMED = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
  function decode(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|quot|apos|amp);/g, (m, ent) => {
      if (ent[0] !== '#') return NAMED[ent];
      const cp = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return m; } // 범위 밖 코드포인트는 원문 유지
    });
  }

  function toValue(node) {
    const hasChildren = node.children.length > 0;
    const hasAttrs = Object.keys(node.attrs).length > 0;
    if (!hasChildren && !hasAttrs) return node.text ? decode(node.text) : '';

    const obj = {};
    for (const [k, v] of Object.entries(node.attrs)) obj[`@${k}`] = v;
    for (const child of node.children) {
      const val = toValue(child);
      if (child.tag in obj) {
        if (!Array.isArray(obj[child.tag])) obj[child.tag] = [obj[child.tag]];
        obj[child.tag].push(val);
      } else {
        obj[child.tag] = val;
      }
    }
    if (node.text) obj['#text'] = decode(node.text);
    return obj;
  }

  skipMisc();
  const root = parseNode();
  if (!root) return null;
  return { [root.tag]: toValue(root) };
}

// 중첩 객체에서 특정 키의 첫 값을 찾기 (resultCode 등 추출용)
export function findFirst(obj, keys) {
  const want = Array.isArray(keys) ? keys : [keys];
  const stack = [obj];
  while (stack.length) {
    const cur = stack.shift();
    if (cur && typeof cur === 'object') {
      for (const k of Object.keys(cur)) {
        if (want.includes(k) && (typeof cur[k] === 'string' || typeof cur[k] === 'number')) return String(cur[k]);
      }
      for (const v of Object.values(cur)) {
        if (v && typeof v === 'object') stack.push(v);
      }
    }
  }
  return null;
}
