# data-go-mcp

공공데이터포털([data.go.kr](https://www.data.go.kr)) 오픈API를 다루는 **MCP 서버**.
Claude 같은 MCP 클라이언트가 오픈API를 검색·호출하고, 서비스 키를 관리할 수 있게 해줍니다.

**의존성 0개** — Node 내장 기능(`fetch`, `stdio`)만 사용하고, MCP(JSON-RPC 2.0 over stdio)를 직접 구현했습니다.

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

## 키 발급 (한 번만)

오픈API 활용신청은 **로그인이 필요해 자동화할 수 없습니다.** `apply_guide` 도구가 절차를 안내합니다.

1. data.go.kr 로그인 → 원하는 API 상세에서 **활용신청**
2. 마이페이지 > 오픈API > 개발계정 에서 **일반 인증키** 확인
3. `save_key` 도구로 저장 → 이후 `call_api` 가 자동 사용

> 키는 `~/.datago-mcp.json`(또는 `$DATAGO_CONFIG`)에 저장되며 `.gitignore` 로 커밋에서 제외됩니다. `config.example.json` 참고.

## 도구 (12개)

| 도구 | 설명 |
|---|---|
| `call_api` | 오픈API 호출 (키 자동 부착·이중 인코딩 보정·JSON/XML 해석) |
| `search_datasets` | 키워드로 데이터셋 검색 (포털 공개 검색, 베스트 에포트) |
| `save_key` · `list_keys` · `remove_key` · `set_default_key` | 서비스 키 관리 |
| `save_endpoint` · `list_endpoints` · `remove_endpoint` | 자주 쓰는 URL 을 별칭으로 |
| `explain_error` · `list_error_codes` | resultCode → 한글 설명 |
| `apply_guide` | 활용신청(키 발급) 방법 안내 |

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
- 활용신청(키 발급)은 로그인이 필요해 이 서버로 자동화하지 않습니다.
