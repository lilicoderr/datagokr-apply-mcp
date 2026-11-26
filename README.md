# datagokr-apply-mcp

공공데이터포털([data.go.kr](https://www.data.go.kr)) 오픈API를 다루는 **MCP 서버**.
Claude 같은 MCP 클라이언트가 오픈API를 검색·호출하고, 서비스 키를 관리하며,
**활용신청(키 발급)까지 브라우저 자동화로 대신** 해줍니다.

- **핵심(API 호출·키 관리)은 의존성 0개** — Node 내장(`fetch`, `stdio`)만, MCP(JSON-RPC 2.0 over stdio) 직접 구현.
- **활용신청 자동화**만 선택적으로 `playwright-core`(시스템/번들 브라우저 구동)를 쓴다. 없으면 그 도구만 비활성화.

> 🔐 **로그인 보안**: 비밀번호를 받지도·저장하지도·로그로 남기지도 않습니다. 처음 한 번 브라우저에서 **직접 로그인**하면 세션 쿠키만 홈 폴더(`~/.datagokr-mcp/`, 저장소 밖 + `.gitignore`)에 보관되어 재사용됩니다. 로그인 정보는 GitHub 에 올라가지 않습니다.

## 왜 필요한가

공공데이터포털 오픈API는 두 가지 함정이 유명합니다. 이 서버가 자동으로 처리합니다.

1. **서비스 키 이중 인코딩** — 포털은 `Encoding 키`(`%2B%2F` 포함)와 `Decoding 키` 두 가지를 줍니다.
   인코딩 키를 또 인코딩하면 `SERVICE_KEY_IS_NOT_REGISTERED(30)` 에러가 납니다.
   → 이 서버는 키 형태를 자동 판별해 한 번만 인코딩하고, 그래도 30이 나면 반대 형태로 1회 재시도합니다.
2. **에러를 HTTP 200 + resultCode 로** — 응답이 JSON/XML 로 섞여 오고 에러도 본문에 담깁니다.
   → JSON/XML 을 모두 파싱하고 공통 `resultCode` 를 한글 설명으로 변환합니다.

## 설치 · 연결

```bash
git clone <repo> && cd data-go-mcp
# 설치할 의존성 없음 (Node 20+ 필요)
node bin/server.js      # 보통은 직접 실행하지 않고, 아래처럼 MCP 클라이언트에 등록
```

### Claude Code

```bash
claude mcp add data-go -- node /절대경로/data-go-mcp/bin/server.js
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "data-go": { "command": "node", "args": ["/절대경로/data-go-mcp/bin/server.js"] }
  }
}
```

## 활용신청 자동화 (키 발급 자동)

브라우저 자동화로 **활용신청을 대신** 넣어준다. (`playwright-core` 필요)

```bash
npm install playwright-core          # 자동신청 쓸 때만
npx playwright@1.49.1 install chromium   # 번들 브라우저 (사용자 브라우저 안 건드림)
```

1. **apply_login** — 브라우저 창이 뜨면 **직접 로그인**(비번은 당신만 입력, 저장 안 됨). 한 번만.
2. **apply_api** `{ idOrUrl: "15012345", purpose: "AI 학습용" }` — 그 오픈API 에 활용신청 자동 제출.
3. **my_applications** — 신청/발급 목록 확인 → 발급된 키를 `save_key` 로 저장하면 `call_api` 에서 바로 사용.

> 자동신청은 포털 페이지 구조에 의존하는 best-effort 다. 버튼/폼이 다르면 `showBrowser: true` 로 과정을 보며 조정하거나, 아래 수동 절차를 따른다.

### (대안) 수동 발급

1. data.go.kr 로그인 → 원하는 API 상세에서 **활용신청**
2. 마이페이지 > 오픈API > 개발계정 에서 **일반 인증키** 확인
3. `save_key` 도구로 저장 → 이후 `call_api` 가 자동 사용

> 키는 `~/.datago-mcp.json`(또는 `$DATAGO_CONFIG`)에 저장되며 `.gitignore` 로 커밋에서 제외됩니다. `config.example.json` 참고.

## 도구 (16개)

| 도구 | 설명 |
|---|---|
| `call_api` | 오픈API 호출 (키 자동 부착·이중 인코딩 보정·JSON/XML 해석) |
| `search_datasets` | 키워드로 데이터셋 검색 (포털 공개 검색, 베스트 에포트) |
| `save_key` · `list_keys` · `remove_key` · `set_default_key` | 서비스 키 관리 |
| `save_endpoint` · `list_endpoints` · `remove_endpoint` | 자주 쓰는 URL 을 별칭으로 |
| `explain_error` · `list_error_codes` | resultCode → 한글 설명 |
| `apply_guide` | 활용신청(키 발급) 방법 안내(글) |
| **`apply_login`** | 브라우저로 data.go.kr 로그인(세션 보관, 비번 미저장) |
| **`apply_api`** | 특정 오픈API 에 **활용신청 자동 제출** |
| **`apply_status` · `my_applications`** | 로그인 상태·신청/발급 목록 확인 |

### 예: 공휴일 조회

```
1) save_key { "name": "main", "key": "<발급받은 키>" }
2) call_api {
     "url": "http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo",
     "params": { "solYear": "2025", "solMonth": "05" }
   }
```

## 구조

```
data-go-mcp/
├─ bin/server.js   stdio MCP 엔트리
├─ src/
│  ├─ mcp.js       MCP 서버 (JSON-RPC 2.0 / stdio, 무의존성)
│  ├─ datago.js    오픈API 호출 · 서비스키 처리 · resultCode 해석
│  ├─ xml.js       소형 XML→객체 파서
│  ├─ registry.js  키/엔드포인트 저장소
│  └─ tools.js     MCP 도구 정의
└─ test/           node:test (27개)
```

## 테스트

```bash
npm test
```

네트워크 없이 검증합니다(`fetch` 주입). 실서버 연동은 `bin/server.js` 를 stdio 로 구동해 확인할 수 있습니다.

## 한계

- `search_datasets` 는 포털 검색 페이지 파싱 기반이라 사이트 구조가 바뀌면 깨질 수 있습니다. (그 땐 포털 링크를 안내)
- 활용신청 자동화는 포털 페이지 구조에 의존해 사이트 개편 시 셀렉터 조정이 필요할 수 있습니다.(로그인 자체는 사람이 1회 수행)
