// 한국 주소 문자열 정규화 (순수 함수, 베스트 에포트).
//   "서울 강남구 테헤란로 152" -> { sido: '서울특별시', sigungu: '강남구', rest: '테헤란로 152' }

export const SIDO = {
  서울: '서울특별시', 부산: '부산광역시', 대구: '대구광역시', 인천: '인천광역시', 광주: '광주광역시', 대전: '대전광역시',
  울산: '울산광역시', 세종: '세종특별자치시', 경기: '경기도', 강원: '강원특별자치도', 충북: '충청북도', 충남: '충청남도',
  전북: '전북특별자치도', 전남: '전라남도', 경북: '경상북도', 경남: '경상남도', 제주: '제주특별자치도',
};

const LONG_TO_SHORT = new Map(Object.entries(SIDO).map(([s, l]) => [l, s]));
// 구 명칭도 받아 준다
const ALIASES = { 충청북도: '충북', 충청남도: '충남', 전라북도: '전북', 전라남도: '전남', 경상북도: '경북', 경상남도: '경남',
  강원도: '강원', 제주도: '제주', 제주특별자치도: '제주', 서울시: '서울', 부산시: '부산', 대구시: '대구', 인천시: '인천',
  광주시: '광주', 대전시: '대전', 울산시: '울산', 세종시: '세종' };

// 시도 이름(약칭/구명칭/정식)을 정식 명칭으로. 모르면 null.
export function normalizeSido(name) {
  const t = String(name ?? '').trim();
  if (!t) return null;
  if (LONG_TO_SHORT.has(t)) return t;
  if (SIDO[t]) return SIDO[t];
  const short = ALIASES[t];
  return short ? SIDO[short] : null;
}

// 주소 앞부분에서 시도·시군구를 떼어낸다. 시도를 못 알아보면 sido 는 null.
export function splitAddress(address) {
  const tokens = String(address ?? '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { sido: null, sigungu: null, rest: '' };
  const sido = normalizeSido(tokens[0]);
  let i = sido ? 1 : 0;
  let sigungu = null;
  if (sido && tokens[i] && /[시군구]$/.test(tokens[i])) {
    sigungu = tokens[i]; i += 1;
    // "수원시 영통구", "성남시 분당구" 처럼 시 + 구
    if (/시$/.test(sigungu) && tokens[i] && /구$/.test(tokens[i])) { sigungu = `${sigungu} ${tokens[i]}`; i += 1; }
  }
  return { sido, sigungu, rest: tokens.slice(i).join(' ') };
}
