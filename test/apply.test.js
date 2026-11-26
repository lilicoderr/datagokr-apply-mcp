import test from 'node:test';
import assert from 'node:assert/strict';
import { toOpenApiUrl, isAvailable, stateFile } from '../src/apply.js';

test('toOpenApiUrl: 숫자 id / URL / data 경로', () => {
  assert.equal(toOpenApiUrl('15012345'), 'https://www.data.go.kr/data/15012345/openapi.do');
  assert.equal(toOpenApiUrl('https://www.data.go.kr/data/15012345/openapi.do'), 'https://www.data.go.kr/data/15012345/openapi.do');
  // 전체 data.go.kr URL 은 그대로 둔다(그 페이지에서 신청)
  assert.equal(toOpenApiUrl('https://www.data.go.kr/data/15067890/fileData.do'), 'https://www.data.go.kr/data/15067890/fileData.do');
  // data.go.kr 이 아닌 곳의 /data/{id}/ 경로는 openapi.do 로 변환
  assert.equal(toOpenApiUrl('/data/15067890/something'), 'https://www.data.go.kr/data/15067890/openapi.do');
  assert.equal(toOpenApiUrl('그냥텍스트'), null);
  assert.equal(toOpenApiUrl(''), null);
});

test('isAvailable / profileDir', () => {
  // playwright-core 설치 여부와 무관하게 호출은 안전해야 함
  assert.equal(typeof isAvailable(), 'boolean');
  // 세션 폴더는 저장소 밖(홈 하위)에 위치
  assert.match(stateFile(), /datagokr-mcp/);
});

test('extractDataPk: id/URL/publicDataPk 추출', async () => {
  const { extractDataPk } = await import('../src/apply.js');
  assert.equal(extractDataPk('15000314'), '15000314');
  assert.equal(extractDataPk('https://www.data.go.kr/data/15000314/openapi.do'), '15000314');
  assert.equal(extractDataPk('/tcs/dss/redirectDevAcountRequestForm.do?publicDataPk=15057552&x=1'), '15057552');
  assert.equal(extractDataPk('none'), null);
});

import { classifyApplyDialog, normalizeIds, DEFAULT_PURPOSE } from '../src/apply.js';

test('classifyApplyDialog: 완료/이미 신청 문구 판정', () => {
  assert.deepEqual(classifyApplyDialog('활용신청이 완료되었습니다.'), { done: true, already: false });
  assert.deepEqual(classifyApplyDialog('정상적으로 신청되었습니다'), { done: true, already: false });
  assert.deepEqual(classifyApplyDialog('이미 활용신청한 내역이 있습니다.'), { done: false, already: true });
  assert.deepEqual(classifyApplyDialog('알 수 없는 문구'), { done: false, already: false });
  assert.deepEqual(classifyApplyDialog(undefined), { done: false, already: false });
});

test('normalizeIds: URL→id, 중복/잘못된 입력 분리', () => {
  const r = normalizeIds(['15000314', 'https://www.data.go.kr/data/15057552/openapi.do', '15000314', 'abc', '', '  15012345  ']);
  assert.deepEqual(r.ids, ['15000314', '15057552', '15012345']);
  assert.deepEqual(r.duplicates, ['15000314']);
  assert.deepEqual(r.invalid, ['abc']);
});

test('normalizeIds: 단일 값, 최대 개수 제한', () => {
  assert.deepEqual(normalizeIds('15000314').ids, ['15000314']);
  const many = Array.from({ length: 60 }, (_, i) => String(15000000 + i));
  const r = normalizeIds(many, { max: 50 });
  assert.equal(r.ids.length, 50);
  assert.equal(r.truncated, 10);
});

test('기본 활용목적 문구 유지', () => {
  assert.match(DEFAULT_PURPOSE, /학습/);
});
