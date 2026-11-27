// MCP resources / prompts — 저장된 키 메타데이터, 사용 가이드, 'find-and-call-api' 프롬프트.
// 키 원문은 절대 노출하지 않는다 (마스킹된 값만).

import { APPLY_GUIDE } from './tools.js';

export function registerResources(server, { registry, usage } = {}) {
  server.resource('datago://keys', {
    name: '저장된 서비스 키 (마스킹)',
    description: '저장된 키 이름·마스킹된 값·인코딩 여부·기본 키. 키 원문은 포함하지 않는다.',
    mimeType: 'application/json',
  }, async () => registry.listKeys());

  server.resource('datago://endpoints', {
    name: '저장된 엔드포인트 별칭',
    description: 'save_endpoint 로 저장한 URL 별칭과 기본 params.',
    mimeType: 'application/json',
  }, async () => registry.listEndpoints());

  if (usage) {
    server.resource('datago://usage', {
      name: '호출량 집계',
      description: '키별 오늘/누적 호출 수 (quota_status 와 동일).',
      mimeType: 'application/json',
    }, async () => (typeof usage.summary === 'function' ? usage.summary() : {}));
  }

  server.resource('datago://guide/usage', {
    name: '사용 가이드',
    description: '검색 → 명세 확인 → (활용신청) → 호출 흐름과 활용신청 절차.',
    mimeType: 'text/markdown',
  }, async () => USAGE_GUIDE);

  server.prompt('find-and-call-api', {
    description: '주제로 오픈API 를 찾아 명세를 확인하고, 필요하면 활용신청한 뒤 호출까지 안내한다.',
    arguments: [
      { name: 'topic', description: '찾고 싶은 데이터 주제 (예: 버스 도착 정보)', required: true },
      { name: 'goal', description: '최종 목적 (선택)', required: false },
    ],
  }, ({ topic, goal }) => [
    `공공데이터포털에서 "${topic}" 데이터를 찾아 호출해 주세요.${goal ? ` 목적: ${goal}` : ''}`,
    '',
    '순서:',
    '1. search_datasets 로 후보를 검색하고 가장 알맞은 API 를 고릅니다.',
    '2. describe_api 로 요청 변수·응답 항목을 확인합니다.',
    '3. list_keys 로 키를 확인합니다. 없으면 apply_api 로 활용신청 후 save_key 로 저장합니다.',
    '4. call_api 로 한 번 호출해 응답을 확인하고, 필요하면 fetch_all/export_data 를 씁니다.',
    '5. 오류 시 explain_error / doctor 를 사용합니다.',
  ].join('\n'));
}

export const USAGE_GUIDE = `# datagokr-mcp 사용 가이드

흐름: search_datasets → describe_api → (apply_api) → call_api → fetch_all / export_data

${APPLY_GUIDE}
`;
