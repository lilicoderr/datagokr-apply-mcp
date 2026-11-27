# Changelog

[Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식, [SemVer](https://semver.org/lang/ko/) 를 따릅니다.

## [2.0.1]

### 수정
- 인증키 자동 수집 안전장치: 저장 전 검증(Encoding 이 Decoding 으로 디코딩되는지, 디코딩 형태 40~200자, 허용 문자). 실패하면 저장하지 않고 마이페이지 > 개발계정에서 복사해 `save_key` 를 쓰라고 안내. 같은 이름에 다른 키가 있으면 덮어쓰지 않고 `<이름>-2` 등으로 저장, 같은 키면 중복 저장 안 함. 무관한 문장 속 "Encoding" 에 속지 않도록 짝이 맞는 후보를 우선
- `assertSafeTargetResolved` 의 IPv6 대괄호 제거 정규식 오타(`/^[|]$/` → `/^[|]$/`)
- README(en/ko): 자동 수집이 실제 포털에서 검증되지 않았음을 명시하고 `save_key` 대안 안내

## [2.0.0]

핵심 흐름에 집중: **검색 → 명세 확인 → 활용신청 → 키 자동 저장 → 호출**. 호환성이 깨지는 변경입니다.

### 추가
- 인증키 자동 수집: 활용신청 성공 뒤 로그인 세션으로 마이페이지 > 개발계정의 일반 인증키(Encoding/Decoding)를 읽어 키 저장소에 저장. 모든 출력·로그에는 마스킹. HTML 추출은 순수 함수(`src/keyextract.js`)이며 가짜 키 픽스처로 테스트
- `apply_get_key` 도구 (수동 재시도)
- 서비스 키 전송 허용 호스트 기본값: `data.go.kr`, `*.go.kr`, `*.or.kr` (`DATAGO_ALLOWED_HOSTS` 로 대체). 호스트명 DNS 해석 후 사설/루프백/링크로컬 주소면 거부, 리다이렉트 미추종
- `package.json` 배포 준비: `private: false`, `files` 화이트리스트 (npx 로 실행 가능). `npm publish` 는 하지 않음

### Removed
- `geo` 도구(`src/geo*.js`, `src/address.js`), `dataset_watch`(`DATAGO_WATCH`), `api_types`, `infer_schema`, `batch_call`, `recommend_datasets`
- HTTP 전송(`--http`, `DATAGO_HTTP_TOKEN`) — stdio 만 지원 (진행률 알림·취소는 유지)
- `apply_guide` (수동 절차는 `apply_setup`/`doctor` 안내로 흡수)
- `list_error_codes` → `explain_error` 에 병합 (code 생략 시 전체 표)
- `apply_apis` → `apply_api` 에 병합 (`idOrUrl` 문자열 또는 `ids` 배열)
- `call_api` 의 `method` 인자 (포털 REST 는 GET, readOnlyHint 유지)
- 도구 29개 → 21개

### 수정
- "자동화 불가" 등 낡고 모순된 안내문, `apply_api` 를 API 마다 한 번 호출하라는 설명
- 브라우저 User-Agent 위장 제거 (Playwright 기본값 사용)
- 활용목적 입력/동의/제출이 실패해도 성공으로 기록하던 문제 → 실패 단계를 `failedStep` 으로 알리고 `ok:false`
- outputSchema 를 선언한 모든 도구가 모든 성공 경로에서 `structuredContent` 반환 (`export_data` 빈 결과 포함)
- structuredContent 키를 영어로 통일: `summary`, `meaning`, `message`, `hint`, `items`, `count`, `pages`, `truncated`, `savedTo`, `rows`, `bytes` 등 (한국어 메시지 본문은 유지)

### 알려진 한계
- 실제 로그인 상태의 포털에서 인증키 자동 수집은 아직 검증되지 않았습니다 (픽스처 테스트만).

## [1.3.0]

### 추가
- MCP **resources**(`datago://keys` 마스킹된 키 메타데이터, `datago://endpoints`, `datago://usage`, `datago://guide/usage`)와 **prompts**(`find-and-call-api`)
- `recommend_datasets` — 자연어 질의를 키워드로 나눠 포털을 검색하고 점수로 재정렬
- `infer_schema` — 실제 응답 표본에서 필드 타입·결측률·enum 후보 추정
- 호스트별 **서킷 브레이커** (연속 5회 실패 시 30초 fail-fast)
- `--print-config [claude-desktop|claude-code|cursor|all]` 설치 스니펫 출력
- 구조화(JSON lines) 로거와 비밀값 마스킹 (`DATAGO_LOG_LEVEL`, `DATAGO_LOG_FORMAT`)
- 문서: `docs/recipes.md`(레시피 5개), `docs/error-catalog.md`(코드에서 생성, `npm run docs:errors`)
- `npm run bench` 오프라인 마이크로 벤치마크
- 로컬 HTTP 서버 + fixture 기반 오프라인 통합 테스트

### 보안
- `export_data`: 심볼릭 링크 덮어쓰기 차단(임시 파일 → rename), Windows 예약 파일명 회피
- 호출 대상 검증: http/https 만, 루프백·사설·메타데이터 주소 차단(`DATAGO_ALLOW_LOCAL=1` 로 해제), `DATAGO_ALLOWED_HOSTS` 허용 목록
- 키/별칭 이름 검증으로 프로토타입 오염 방지, 손상 백업 파일 0600

### 변경
- 테스트 127 → 168개
- 호환성 주의: 로컬/사설 주소로의 `call_api` 는 기본 차단됩니다

## [1.2.0]

### 추가
- `export_data` — 전 페이지를 순회해 CSV(엑셀용 BOM)/JSON 파일로 저장하고 경로만 반환. 내보내기 폴더(`DATAGO_EXPORT_DIR`) 밖에는 쓰지 않고, `=` `+` `-` `@` 로 시작하는 CSV 셀은 수식 주입을 막도록 처리
- `batch_call` — 같은 API 를 여러 params 로 차례 호출 (호출 간격 `intervalMs`, 최대 50건, `stopOnError`)
- `api_types` — 명세에서 요청 변수/응답 항목의 TypeScript 인터페이스 생성
- `call_api` 의 `cacheSeconds` — 성공 응답을 메모리 TTL/LRU 캐시에 보관해 일일 트래픽 절약
- `doctor --fix` — 설정 파일 생성, 파일 권한(`chmod 600`), Chromium 설치를 자동 수정 (키·로그인은 건드리지 않음)
- 영어 README 를 기본으로, 한국어는 `README.ko.md`
- CI: 커버리지 요약 잡, 주간 보안 워크플로(`npm audit` + git 히스토리 자격증명 스캔), Dependabot

### 개선
- `fetch_all` 과 `export_data` 가 페이지 수집 로직을 공유
- 테스트 97 → 127개

## [1.1.0]

### 추가
- `find_apply_targets` 가 브라우저·로그인 없이 공개 페이지만으로 "개발단계 자동승인 REST" API 를 골라냄 (기존: 상세 페이지를 브라우저로 하나씩 열던 방식)
- `describe_api` — 데이터 id 로 요청주소·필수/선택 파라미터·응답 항목·트래픽 조회 (공개 페이지, 로그인 불필요)
- `fetch_all` — 페이지네이션 자동 순회, 항목만 합쳐 반환 (`maxPages` 상한)
- `quota_status` — 오늘(KST) 키별 호출량과 일일 한도 대비 남은 양 추정
- `doctor` — Node/키/네트워크/브라우저/세션/호출량 점검 (MCP 도구 + `node bin/server.js doctor`)
- `call_api` 의 `itemsOnly` / `maxItems` 옵션으로 응답을 항목 위주로 간추림
- `search_datasets` 가 분류·제공기관·요약·활용신청 수·전체 건수를 구조화해 반환
- `my_applications` 가 [승인]/[신청]/[반려] 별로 집계
- `DATAGO_DEBUG=1` 요청 로그 (서비스 키 마스킹)
- `--version`, `--help`
- Claude Code 스킬(`skills/datagokr`), `.mcp.json` 예시, CONTRIBUTING / SECURITY / 이슈·PR 템플릿

### 개선
- 일시 장애(네트워크 오류, HTTP 5xx/429, resultCode 01·02·05)를 지수 백오프로 재시도
- resultCode 별 "다음에 할 일" 힌트, 네트워크 오류 한글 메시지(DNS/연결 거부/타임아웃)
- `apply_apis` 가 브라우저 1개를 재사용하고, 로그인 세션이 없으면 즉시 중단, id 중복·오입력 정리(최대 50건)
- CI: Node 20/22 × Ubuntu/Windows 매트릭스

### 수정
- XML 숫자 문자 참조(`&#xAC00;`) 미디코딩, 이중 디코딩 가능성
- `INFO-000`/`NORMAL_SERVICE` 등 기관별 정상 코드를 실패로 오판하던 문제
- 설정 파일이 손상되면 저장된 키가 빈 상태로 덮어써지던 문제 — 이제 `.corrupt-<시각>.bak` 으로 백업 후 진행
- 설정 파일을 원자적으로 저장하고 POSIX 에서 `0600` 권한으로 생성
- 공백이 섞였거나 너무 짧은 키는 저장 시 거부

## [1.0.0]

- 무의존성 MCP 서버(stdio JSON-RPC 2.0), `call_api` / 키·엔드포인트 관리 / resultCode 해석
- 서비스 키 이중 인코딩 자동 보정
- 브라우저 자동화 활용신청 (`apply_login`, `apply_status`, `apply_api`, `apply_apis`, `find_apply_targets`, `my_applications`)
