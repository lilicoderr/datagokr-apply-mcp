// use_api 가 돌려주는 "바로 실행할 수 있는 예시" (순수 함수).
// 실제 서비스 키는 절대 받지도 싣지도 않는다 — 환경 변수 DATAGO_SERVICE_KEY(일반 인증키 Decoding) 자리표시자만 쓴다.
// URL·파라미터 값은 포털 페이지에서 온 문자열이므로 셸에서 실행되지 않게 작은따옴표로 감싼다.

export const KEY_ENV = 'DATAGO_SERVICE_KEY';

// POSIX 셸 작은따옴표: 안에서는 아무것도 해석되지 않는다. ' 만 '\'' 로 바꾼다.
const sq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

// call_api(buildQuery)와 같은 규칙: 배열은 키 반복, 객체는 JSON, null/undefined 는 생략
export function queryPairs(params = {}) {
  const pairs = [];
  for (const [k, v] of Object.entries(params)) {
    for (const one of Array.isArray(v) ? v : [v]) {
      if (one === undefined || one === null) continue;
      pairs.push([k, typeof one === 'object' ? JSON.stringify(one) : String(one)]);
    }
  }
  return pairs;
}

export function buildCurl(url, params) {
  const lines = [`curl -G ${sq(url)}`, `  --data-urlencode "serviceKey=\${${KEY_ENV}}"`,
    ...queryPairs(params).map(([k, v]) => `  --data-urlencode ${sq(`${k}=${v}`)}`)];
  return lines.join(' \\\n');
}

export function buildJs(url, params) {
  return [
    `const url = new URL(${JSON.stringify(url)});`,
    `url.searchParams.set('serviceKey', process.env.${KEY_ENV});`,
    `for (const [k, v] of ${JSON.stringify(queryPairs(params))}) url.searchParams.append(k, v);`,
    'const res = await fetch(url);',
    'console.log(await res.text());',
  ].join('\n');
}

/** @param {{ url: string, params: Record<string, any>, alias?: string|null, keyName?: string|null }} o */
export function buildExample({ url, params, alias, keyName }) {
  return {
    call_api: { ...(alias ? { endpoint: alias } : { url }), params, ...(keyName ? { keyName } : {}) },
    curl: buildCurl(url, params),
    js: buildJs(url, params),
    env: `${KEY_ENV} = 일반 인증키(Decoding). 키를 코드/저장소에 직접 넣지 마세요. curl 은 bash 기준, JS 는 Node 18+ ESM.`,
  };
}
