# Changelog

[Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식, [SemVer](https://semver.org/lang/ko/) 를 따릅니다.

## [2.3.0]

핵심 흐름(검색 → 명세 → 신청 → 키 → 호출)을 한 번에 도는 `use_api` 도구와 CLI `use` 를 추가했습니다. 도구는 22개가 됩니다. **실제 포털은 미검증**(로컬 가짜 포털 + 헤드리스 Chromium, 목으로만 확인).

### 추가
- `use_api { idOrUrl, confirm, dryRun, ... }`: 명세 읽기 → (저장된 키가 거부되면) 활용신청 → 검증된 경로로 키 저장(덮어쓰지 않음) → 샘플 파라미터로 시험 호출 → 별칭 저장 → `call_api` 인자·curl·JS 예시(키는 `DATAGO_SERVICE_KEY` 자리표시자). 신청 제출은 정확히 `confirm:true` 일 때만, `dryRun` 은 아무것도 바꾸지 않음
- 이어 하기: 설정 파일에 데이터 id·시각·키 이름만 기록해 다시 실행하면 재신청 없이 이어 감. 승인 반영 전(20/30)이면 `pending_activation` + `retryAfter`
- 진행률 알림, 취소(제출 기록은 보존), 같은 id 동시 실행 방지, 결과에서 저장된 키 전부 가리기
- CLI `datagokr-apply-mcp use <id|URL> [--dry-run] [--confirm] [--param k=v] [--json]` (종료코드 0 완료 / 2 사용자 조치 / 1 오류)
- 가짜 포털에 명세 페이지·키 검사 API 추가, `test/use-e2e.test.js`(CI browser 잡에서 실행)

### 변경
- 인증키 수집 로직을 `src/keystore.js` 로 분리(apply_api·apply_get_key·use_api 공용, 동작 동일)

### CI
- 신청 흐름 브라우저 테스트를 실제로 실행하는 Ubuntu `browser` 잡 추가(잠긴 `playwright-core` 에 맞는 Chromium 설치, 건너뛰면 실패). 상대는 로컬 가짜 포털이며 **실제 포털은 여전히 미검증**

## [2.2.0]

### 신청 흐름 (로컬 가짜 포털 + 헤드리스 Chromium 으로 확인, **실제 포털은 미검증**)
- 동의 항목이 체크되지 않던 문제, "이미 신청됨"·세션 만료를 놓치던 문제, 반려 문구가 사라지던 문제
- "완료되지 않음" 문구를 성공으로 보고하던 문제, 늦게 뜨는 결과, 빈 활용목적, 목록·키 페이지 레이아웃 변형 처리

### 보안
- DNS rebinding: 검사와 연결이 DNS 를 따로 조회하던 것을, 연결에 쓰는 응답을 검사하는 `src/safefetch.js`(node:http/https)로 교체
- 사설 주소 판정을 `net.BlockList` 로 바꿔 IPv6 로 감싼 IPv4(NAT64·6to4·호환 주소)와 멀티캐스트/예약 대역, 끝점(`localhost.`) 차단
- 서버가 되비춘 서비스 키를 응답·네트워크 오류에서 `***` 처리, 로거는 인코딩 형태까지 마스킹
- URL 형식 오류 메시지, `list_endpoints`, 손상 설정 파일 알림에서 키가 노출되던 문제
- `toString` 같은 상속 속성 이름이 저장된 키/별칭으로 취급되던 문제

### 수정
- 직접 넘긴 키의 호출이 기본 키의 캐시·호출량으로 섞이던 문제, `fetch_all`/`export_data` 스키마에 `skipValidation` 선언, 중간 페이지 실패 시 `truncated: true`, `COM¹` 류 Windows 장치 이름 처리

### 문서
- README(en/ko)·스킬·레시피를 stdio 로 확인한 도구 목록과 실제 출력에 맞춤

## [2.1.0]

핵심 흐름(검색 → 명세 → 신청 → 키 → 호출)의 견고성·안내를 다듬었습니다. 새 도구는 없습니다(21개 그대로).

> **여전히 미검증:** 활용신청 후 마이페이지에서 인증키를 자동으로 읽는 부분은 로그인된 실제 포털 페이지로 확인하지 못했습니다(가짜 키 fixture 로만 테스트). 실패하면 저장하지 않고 `save_key` 로 직접 저장하라고 안내합니다.

### 추가
- 실제 공개 페이지(검색 결과·상세·기능별 조각·404·빈 검색)를 정리한 fixture(`test/fixtures/real/`)와 회귀 테스트
- `describe_api` 의 `operation` 인자: 상세기능이 여러 개인 API 의 기능별 요청주소/변수/응답을 포털 페이지가 쓰는 공개 조회 경로로 읽음
- `call_api`/`fetch_all`/`export_data`: `describe_api` 로 명세를 본 뒤 필수 변수가 빠지면 **호출하지 않고**(트래픽 절약) `summary.missing` 반환. `skipValidation: true` 로 우회. `describe_api { saveAs }` 로 저장한 별칭에는 필수 변수 목록이 함께 저장됨. 명세에 없는 변수는 `warnings`
- 모든 도구 실패에 한국어 `message`/`오류:` 문장과 영어 `hint` (`error`+`hint` 구조화 출력). `call_api` 요약은 `hint`(영어)+`advice`(한국어)
- 모든 `apply_*` 결과에 `next`(다음에 부를 도구)와 영어 `hint`. `my_applications` 도 구조화 출력
- `doctor`: 포털 명세 파서가 현재 레이아웃을 읽는지(`portal`), `DATAGO_ALLOWED_HOSTS` 확장(`hosts`) 점검
- 배포물 테스트(`npm pack` 파일 목록, CHANGELOG/버전 일치), SKILL.md·README 가 언급한 도구가 실제 `server.tools` 와 일치하는지 테스트

### 수정
- `&#034;` 같은 숫자 문자 참조를 디코딩(이중 디코딩은 방지), 검색 결과 0건을 `null` 이 아닌 0 으로
- 포털 페이지 가져오기 오류(404/5xx/네트워크/타임아웃)를 한국어 안내 + 영어 hint 로 구분. LINK/비REST 는 `reason: "not_rest"`
- 200 이어도 본문이 HTML(게이트웨이/점검 페이지)이면 성공으로 보지 않음. 코드 없는 평문/XML 문구(`SERVICE KEY IS NOT REGISTERED` 등)를 표준 resultCode 로 매핑, `code: 200`·서울 열린데이터 코드(INFO-200 등) 해석
- 배열 파라미터는 키 반복, 객체는 JSON 문자열로 인코딩(`[object Object]` 방지). `params` 안의 `serviceKey` 가 쿼리에 두 번 붙던 문제
- `export_data` 가 잘못된 `format` 을 API 호출 뒤가 아니라 호출 전에 거부

### 문서
- README(en/ko): npm 레지스트리 미배포 상태와 tarball 설치법, 흐름 섹션 갱신

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
