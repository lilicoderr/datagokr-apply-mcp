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
