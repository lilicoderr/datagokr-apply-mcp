<div align="center">

# datagokr-apply-mcp

**공공데이터포털(data.go.kr) 오픈API를 Claude가 직접 검색·신청·호출하게 해주는 MCP 서버**

[![CI](https://github.com/lilicoderr/datagokr-apply-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/lilicoderr/datagokr-apply-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)
![Dependencies](https://img.shields.io/badge/runtime%20deps-0-brightgreen)
![MCP](https://img.shields.io/badge/MCP-stdio%20JSON--RPC%202.0-8A2BE2)

[English](README.md) · **한국어**

[빠른 시작](#빠른-시작) · [도구 목록](#도구-21개) · [활용신청 자동화](#활용신청-자동화) · [보안](#보안) · [FAQ](#faq) · [기여하기](CONTRIBUTING.md)

</div>

---

> "버스 도착정보 API 찾아서 신청하고, 내일 날씨 호출해줘."
>
> 키 발급 → 이중 인코딩 → XML 파싱 → 트래픽 한도까지, 공공데이터 API에서 막히는 지점을 Claude가 알아서 넘어갑니다.

## 왜 만들었나

공공데이터포털 오픈API는 쓰기 전에 사람이 해야 하는 일이 많고, 쓰다 보면 함정이 많습니다.

| 막히는 지점 | 이 서버가 하는 일 |
|---|---|
| 검색 → 상세 → **활용신청 → 승인 대기 → 키 복사** 를 사람이 클릭 | 브라우저 자동화로 **활용신청을 대신 제출** (일괄 신청 포함) |
| 서비스 키 **이중 인코딩** → `SERVICE_KEY_IS_NOT_REGISTERED(30)` | 키 형태 자동 판별, 30 이면 **반대 형태로 1회 자동 재시도** |
| 에러도 **HTTP 200**, 응답은 JSON/XML 제각각 | 둘 다 파싱, `resultCode` 를 **한글 설명 + 조치 방법**으로 변환 |
| 요청 변수를 몰라서 추측 호출 → `resultCode 10/11/12` | `describe_api` 로 **요청주소·필수 파라미터·응답 항목** 먼저 확인 |
| 일시 장애(5xx, 타임아웃) | **지수 백오프 재시도** |
| 결과가 여러 페이지 | `fetch_all` 이 **전 페이지 자동 순회** |
| 일일 트래픽(보통 1,000회) 초과 | `quota_status` 로 **오늘 호출량 추정** |

런타임 의존성은 **0개**입니다 (Node 내장 모듈만 사용, MCP 프로토콜도 직접 구현). 활용신청 자동화만 선택적으로 `playwright-core` 를 씁니다.

## 데모

대화 흐름 예시입니다 (도구 출력은 요약).

```text
You     ▸ 공휴일 조회 API 찾아서 어떻게 부르는지 알려줘

Claude  ▸ search_datasets { query: "특일 정보" }
        ▸ describe_api { idOrUrl: "15012690", operation: "공휴일", saveAs: "특일정보" }
          요청주소: …/SpcdeInfoService/getRestDeInfo
          [필수] solYear   [선택] solMonth
        ▸ apply_status → apply_api { idOrUrl: "15012690" }   # 키가 없다면 활용신청까지 자동
        ▸ call_api { endpoint: "특일정보", params: { solYear: 2025, solMonth: "05" }, itemsOnly: true }
          ok · resultCode 00 · 키인코딩 Decoding · 시도 1회
```

`describe_api` **실제 출력 발췌** (포털 15012690 상세 페이지 기준, 일부 생략):

```jsonc
{
  "title": "한국천문연구원_특일 정보",
  "traffic": "개발계정 : 10,000 / 운영계정 : 활용사례 등록시 신청하면 트래픽 증가 가능",
  "endpoint": "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getAnniversaryInfo",
  "operations": ["기념일 정보 조회", "공휴일 정보 조회", "국경일 정보조회", "24절기 정보 조회", "잡절 정보 조회"],
  "request": ["[필수] pageNo(페이지 번호) 예:1 — 페이지번호", "[필수] solYear(연) 예:2019 — 연", "[선택] solMonth(월) 예:02 — 월"]
}
```

## 빠른 시작

**필요한 것:** Node.js 20+ · (활용신청 자동화를 쓸 때만) 데이터포털 계정

```bash
git clone https://github.com/lilicoderr/datagokr-apply-mcp.git
cd datagokr-apply-mcp
node bin/server.js doctor        # 환경 점검 (의존성 설치 불필요)
```

### 설치 방법 (npm 레지스트리 미배포)

아직 npm 레지스트리에 올리지 않았으므로 `npx datagokr-apply-mcp` 는 동작하지 않아요. 지금은:

```bash
npm pack                                          # datagokr-apply-mcp-<버전>.tgz 생성 (런타임 의존성 없음)
npm install -g ./datagokr-apply-mcp-<버전>.tgz
datagokr-apply-mcp --version                      # 이후 MCP 명령으로 "datagokr-apply-mcp" 사용
```

### Claude Code

```bash
claude mcp add datagokr -- node /절대경로/datagokr-apply-mcp/bin/server.js
```

또는 프로젝트 루트의 `.mcp.json` ([예시 파일](.mcp.json.example)):

```json
{
  "mcpServers": {
    "datagokr": { "command": "node", "args": ["/절대경로/datagokr-apply-mcp/bin/server.js"] }
  }
}
```

### Claude Desktop

`claude_desktop_config.json` 의 `mcpServers` 에 위와 같은 항목을 추가하세요.

### Claude Code 스킬 (선택)

[`skills/datagokr/SKILL.md`](skills/datagokr/SKILL.md) 를 `~/.claude/skills/datagokr/` 에 복사하면, "공공데이터 API 써줘" 같은 요청에서 Claude 가 **검색 → 명세 확인 → 신청 → 호출** 순서를 따릅니다.

## 도구 (21개)

`playwright-core` 가 없으면 17개가 보여요: 활용신청 도구 5개 대신 켜는 방법을 알려주는 `apply_setup` 이 나옵니다.

**호출 · 탐색** — 로그인 불필요

| 도구 | 설명 |
|---|---|
| `search_datasets` | 키워드로 오픈API 검색 (제목·분류·기관·요약·활용신청 수) |
| `find_apply_targets` | 키워드로 **개발단계 자동승인 REST** API 만 골라 id 목록 (브라우저 없이 공개 페이지 기반) |
| `describe_api` | 데이터 id → **요청주소 · 필수/선택 파라미터 · 응답 항목 · 트래픽**. 상세기능이 여러 개면 `operation`(id 또는 이름 일부)으로 선택 |
| `call_api` | 오픈API 호출. 키 자동 부착, 이중 인코딩 보정, JSON/XML 해석, 재시도, `itemsOnly`, `cacheSeconds`(TTL 캐시로 트래픽 절약). `describe_api` 로 명세를 본 뒤 필수 변수가 빠지면 **호출하지 않음**(`skipValidation:true` 로 우회) |
| `fetch_all` | 페이지네이션 자동 순회 → 항목만 합쳐 반환 (`maxPages` 기본 5, 최대 50. 일부만 받으면 `truncated`) |
| `export_data` | 전체 결과를 **CSV(엑셀용 BOM)/JSON 파일**로 저장하고 경로만 반환 (AI 컨텍스트 절약) |
| `quota_status` | 오늘(KST) 키별 호출량 · 남은 한도 추정 |
| `explain_error` | `resultCode` → 한글 설명 (code 생략 시 전체 표) |

**키 · 별칭 관리**

| 도구 | 설명 |
|---|---|
| `save_key` · `list_keys` · `remove_key` · `set_default_key` | 서비스 키 관리 (Encoding/Decoding 아무거나) |
| `save_endpoint` · `list_endpoints` · `remove_endpoint` | 자주 쓰는 URL 을 별칭 + 기본 파라미터로 저장 |

**활용신청 자동화** — `playwright-core` 필요, 로그인 세션 필요

| 도구 | 설명 |
|---|---|
| `apply_login` | 로그인 창 열기 (논블로킹, 비밀번호 미저장) |
| `apply_status` | 로그인 세션 유효 여부 확인 |
| `apply_api` | 활용신청 제출 — 1건(`idOrUrl`) 또는 여러 건(`ids`, 브라우저 1개 재사용·중복 제거). 성공하면 **마이페이지의 일반 인증키를 읽어 자동 저장**(모든 출력에서 마스킹) |
| `apply_get_key` | 마이페이지 > 개발계정의 일반 인증키(Encoding/Decoding)를 다시 읽어 `save_key` 처럼 저장 |
| `my_applications` | 신청/승인/반려 현황 (상태별 집계) |

**진단**

| 도구 | 설명 |
|---|---|
| `doctor` | Node · 키 · 네트워크 · 브라우저 · 세션 · 호출량 점검 + 고치는 방법 (CLI: `node bin/server.js doctor`, 설정 파일·권한·Chromium 은 `doctor --fix` 로 자동 수정) |

MCP 리소스(`datago://keys`(마스킹) · `datago://endpoints` · `datago://usage` · `datago://guide/usage`)와 `find-and-call-api` 프롬프트도 제공합니다. 클라이언트별 설정 스니펫은 `node bin/server.js --print-config` 로 출력해요.

## 활용신청 자동화

```bash
npm install playwright-core                 # 자동신청을 쓸 때만
npx playwright-core install chromium        # 번들 Chromium (내 브라우저는 건드리지 않음)
node bin/server.js doctor                   # ✅ 가 나오는지 확인
```

Claude 가 따르는 흐름 (각 도구 설명에 "다음에 뭘 할지"가 들어 있음):

1. `apply_status` — 로그인됐는지 확인
2. 안 돼 있으면 `apply_login` — **창만 열고 바로 반환**합니다. 그 창에서 **직접 로그인만** 하면 됩니다. 세션은 몇 초마다 자동 저장되고, 다음 `apply_status` 가 로그인을 확인하면 창이 닫힙니다. (보통 최초 1회)
3. `find_apply_targets` → `apply_api` — 1건 또는 `ids` 로 여러 건 신청. 성공하면 **인증키를 마이페이지에서 자동으로 읽어 저장**합니다(원문 미출력). 실패하면 `apply_get_key`.
4. `call_api` — 저장된 키가 자동으로 붙습니다. 승인 여부는 `my_applications`.

> **실제 포털에서는 아직 검증되지 않았습니다.** 인증키 자동 수집은 마이페이지 마크업에 의존하며, 시도하는 포털 URL도 실제 로그인 페이지로 확인한 적이 없습니다. 추출 로직은 가짜 키 픽스처로만 테스트했습니다. 검증(Encoding 이 Decoding 으로 디코딩됨, 40~200자, 문자 집합)을 통과한 값만 저장하며, 통과하지 못하면 아무것도 저장하지 않습니다. 같은 이름에 다른 키가 이미 있으면 덮어쓰지 않고 `<이름>-2` 로 저장합니다. **대안:** 데이터포털 마이페이지 > 개발계정의 일반 인증키를 직접 복사해 `save_key` 로 저장하세요.

> 자동신청은 **개인회원 + REST형 자동승인 API** 에서 동작합니다. LINK형(외부 바로가기)·기업회원 전용 API 는 "신청 폼을 열지 못했다"고 알려줍니다. 개인회원 자동승인 API 11건 신청·승인으로 검증했습니다.

수동으로 발급받아도 됩니다: 포털 로그인 → API 상세에서 **활용신청** → 마이페이지 > 개발계정 > **일반 인증키** → `save_key`.

## 설정

| 환경 변수 | 기본값 | 용도 |
|---|---|---|
| `DATAGO_CONFIG` | `~/.datago-mcp.json` | 서비스 키 · 엔드포인트 저장 파일 ([예시](config.example.json)) |
| `DATAGO_USAGE` | `~/.datago-usage.json` | 호출량 집계 (키 값은 저장하지 않고 이름만) |
| `DATAGO_EXPORT_DIR` | `~/datago-exports` | `export_data` 가 파일을 만드는 폴더 (이 밖에는 저장하지 않음) |
| `DATAGO_HOME` | `~/.datagokr-mcp` | 로그인 세션(쿠키) 폴더 |
| `DATAGO_STATE` | `$DATAGO_HOME/storage-state.json` | 세션 파일 경로 직접 지정 |
| `DATAGO_ALLOWED_HOSTS` | `data.go.kr`, `*.go.kr`, `*.or.kr` | 서비스 키를 보낼 수 있는 도메인(하위 포함, 쉼표 구분). 지정하면 기본 목록을 대체 |
| `DATAGO_ALLOW_LOCAL` | (꺼짐) | `1` 이면 호스트 허용목록·사설주소 검사를 끔 (테스트/개발 전용) |
| `DATAGO_LOG_LEVEL` / `DATAGO_LOG_FORMAT` | (꺼짐) / `json` | `error\|warn\|info\|debug`, `text` 는 평문 |
| `DATAGO_DEBUG` | (꺼짐) | `1` 이면 요청 URL·응답 상태·소요 시간을 stderr 로 출력 (서비스 키는 `***` 로 가림) |

## 보안

- **비밀번호를 받지도, 저장하지도, 로그로 남기지도 않습니다.** 로그인은 사람이 브라우저에서 직접 합니다.
- 로그인 뒤 세션 쿠키만 **홈 폴더**(`~/.datagokr-mcp/`, 저장소 밖)에 보관합니다. `.gitignore` 에도 등록돼 있어 커밋될 수 없습니다.
- 서비스 키 파일은 **원자적으로 저장**되고(쓰다 중단돼도 안 깨짐), POSIX 에서는 `0600` 권한으로 만들어집니다. 파일이 손상돼도 **백업 후** 진행해 키가 조용히 사라지지 않습니다.
- `call_api` / `fetch_all` / `export_data` 는 서비스 키를 **허용된 호스트**(`data.go.kr`, `*.go.kr`, `*.or.kr`, 또는 `DATAGO_ALLOWED_HOSTS`)로만 보내고 리다이렉트는 따라가지 않습니다. 루프백·사설·링크로컬·예약 대역(IPv6 로 감싼 IPv4 포함)은 거부하며, **실제 연결에 쓰는 DNS 응답**을 검사하므로 DNS rebinding 으로 검사 후 주소를 바꿀 수 없습니다.
- 서버가 요청을 되비춰도 도구 출력과 내보내기 파일에 들어가기 전에 키를 `***` 로 가립니다. `list_endpoints` 는 저장한 URL/params 에 붙여 넣은 `serviceKey` 를 가려서 보여줍니다.
- **한계:** `*.or.kr` 는 정부 기관만 쓰는 도메인이 아닙니다. 엄격하게 쓰려면 `DATAGO_ALLOWED_HOSTS=data.go.kr` 로 좁히고 필요한 기관 호스트만 추가하세요. 많은 기관 API 가 평문 `http://` 라 키가 암호화 없이 전송되니 지원하면 `https://` 를 쓰세요. 서버가 키를 변형해(쪼개기, base64 등) 돌려주면 가리지 못합니다.
- `export_data` 는 내보내기 폴더 안에만 저장하고, `=` `+` `-` `@` 로 시작하는 CSV 셀은 수식 주입을 막기 위해 무력화합니다.
- 활용신청 뒤 자동으로 읽은 인증키는 키 파일에만 저장되고, 모든 도구 출력·로그에는 마스킹돼 나옵니다.
- `list_keys` / `doctor` 는 키를 마스킹해서 보여주며, 호출량 집계 파일에는 키 값이 들어가지 않습니다.
- 취약점 신고는 [SECURITY.md](SECURITY.md) 를 참고하세요.

## FAQ

<details>
<summary><b>resultCode 30 (SERVICE_KEY_IS_NOT_REGISTERED) 이 계속 나와요</b></summary>

① 활용신청 직후라면 승인까지 1~2시간 걸릴 수 있어요. ② 키를 다른 API 용으로 받은 건 아닌지 확인하세요. ③ 이 서버는 Encoding/Decoding 키를 자동으로 맞춰 재시도하니, 그래도 30 이면 키 자체 문제입니다. `node bin/server.js doctor` 로 키 상태를 점검하세요.
</details>

<details>
<summary><b>apply_* 도구가 안 보여요</b></summary>

`playwright-core` 가 없으면 그 도구들만 꺼지고 `apply_setup` 안내가 대신 나옵니다. `npm install playwright-core && npx playwright-core install chromium` 후 서버를 재시작하세요.
</details>

<details>
<summary><b>일일 트래픽을 초과(22)했어요</b></summary>

개발계정은 보통 일 1,000회(API마다 다름)이고 자정(KST)에 초기화됩니다. `quota_status` 로 이 서버를 통한 오늘 호출량을 볼 수 있어요. 활용사례를 등록하면 운영계정으로 증설 신청이 가능합니다.
</details>

<details>
<summary><b>포털 구조가 바뀌면요?</b></summary>

검색·명세·신청은 포털 HTML 에 의존합니다. 파싱 로직은 순수 함수([`src/portal.js`](src/portal.js))로 분리하고 실제 페이지에서 뜬 fixture 로 테스트하므로, 깨지면 fixture 를 갱신하고 해당 함수만 고치면 됩니다. 이슈로 알려주세요.
</details>

## 구조

```
datagokr-apply-mcp/
├─ bin/server.js        stdio MCP 엔트리 · doctor · --print-config · --version
├─ src/
│  ├─ mcp.js            MCP 서버 (JSON-RPC 2.0 / stdio, 무의존성)
│  ├─ tools.js          호출·탐색·키 관리 도구
│  ├─ datago.js         호출 · 키 인코딩 · resultCode 해석 · 백오프 재시도
│  ├─ security.js       호스트 허용목록 · 주소 검사 · 키 가리기
│  ├─ safefetch.js      접속하는 주소를 검사하는 HTTP 클라이언트
│  ├─ portal.js         포털 상세/검색 페이지 파서
│  ├─ items.js, xml.js  표준 응답 → 항목/페이징 정규화 · 소형 XML 파서
│  ├─ registry.js       키/엔드포인트 저장소 (원자적 저장, 손상 백업)
│  ├─ usage.js, cache.js, breaker.js   일일 호출량(KST) · TTL 캐시 · 서킷 브레이커
│  ├─ export.js         CSV/JSON 내보내기 (경로 이탈·수식 주입 차단)
│  ├─ apply.js, tools-apply.js, keyextract.js   활용신청 자동화 (Playwright)
│  ├─ doctor.js, selfcheck.js, printconfig.js   환경 점검 · 설치 검증 · 클라이언트 설정 스니펫
│  └─ ...               로깅, 리소스/프롬프트, 출력 스키마, 힌트
├─ skills/datagokr/     Claude Code 스킬
└─ test/                node:test (+ 실제 페이지 fixture)
```

## 개발

```bash
npm ci                   # 개발 도구(typescript) + 선택 의존성 playwright-core
npm test                 # 외부 네트워크/브라우저 없이 검증 (fetch 주입, 로컬 테스트 서버)
npm run typecheck
node bin/server.js doctor
```

신청 흐름 브라우저 테스트(`test/apply-e2e.test.js`)는 헤드리스 Chromium 으로 **로컬 가짜 포털**을 상대하며, Chromium 이 없으면 건너뜁니다. CI 는 Ubuntu 전용 `browser` 잡에서 실행하고, 거기서는 건너뛰면 실패합니다. 통과해도 실제 data.go.kr 동작은 이 테스트로 **검증되지 않습니다.**

기여 방법은 [CONTRIBUTING.md](CONTRIBUTING.md), 변경 내역은 [CHANGELOG.md](CHANGELOG.md) 를 보세요.

## 라이선스

[MIT](LICENSE)
