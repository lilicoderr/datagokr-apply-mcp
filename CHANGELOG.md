# Changelog

[Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식, [SemVer](https://semver.org/lang/ko/) 를 따릅니다.

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
