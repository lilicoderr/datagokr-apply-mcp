---
name: datagokr
description: 공공데이터포털(data.go.kr) 오픈API 를 찾고, 활용신청(키 발급)하고, 호출할 때 사용한다. "공공데이터", "오픈API", "data.go.kr", "활용신청", 날씨/버스/미세먼지/공휴일 같은 한국 공공 데이터를 쓰려는 요청에 해당. datagokr MCP 서버(datagokr-apply-mcp)가 연결돼 있어야 한다.
---

# 공공데이터포털 API 사용 절차

datagokr MCP 도구를 아래 순서로 쓴다. 추측으로 호출하지 말고 **명세를 먼저 확인**한다.

## 0. 막히면 먼저

호출이 이상하거나 `apply_*` 도구가 안 보이면 `doctor` 를 실행해 원인과 고치는 방법을 확인한다. (터미널에서는 `node bin/server.js doctor --fix` 로 설정 파일·권한·Chromium 을 자동 수정할 수 있다.)

## 1. 대상 API 찾기

- `search_datasets { query }` — 로그인 없이 검색. 제목·분류·기관·요약·활용신청 수가 나온다.
- 후보를 고를 때 **활용신청 수가 많고 최근 수정된** 것을 우선한다.

## 2. 명세 확인

- `describe_api { idOrUrl }` — 요청주소, 필수/선택 파라미터(샘플값), 응답 항목, 일일 트래픽.
- 필수 파라미터를 빠뜨리면 `resultCode 11`, 형식이 틀리면 `10`, 주소가 틀리면 `12` 가 난다.
- 상세기능이 여러 개면 요청주소는 첫 기능 기준이다. 서비스URL 뒤에 오퍼레이션명을 붙여 다른 기능을 부른다.

## 3. 키 확보 (활용신청 → 키 자동 저장)

- `list_keys` 로 저장된 키가 있는지 본다. 있으면 4번으로.
- 없으면 활용신청이 필요하다 (`playwright-core` 설치 시 자동화). 순서:
  1. `apply_status` — 로그인 확인
  2. 안 됐으면 `apply_login` 을 부르고 **사용자에게 "뜬 창에서 로그인해 달라"고 안내**한 뒤, 잠시 후 `apply_status` 로 확인. 비밀번호를 대신 입력하거나 요구하지 않는다.
  3. `find_apply_targets { keyword }` 로 자동승인 REST API 를 고르고, `describe_api` 로 명세를 확인한다.
  4. `apply_api { idOrUrl }` — 여러 개면 `apply_api { ids: [...] }` 로 **한 번에**. 신청이 성공하면 마이페이지 > 개발계정의 일반 인증키(Encoding/Decoding)를 **자동으로 읽어 저장**한다. 키 원문은 출력되지 않는다(마스킹).
  5. 키 저장이 실패했으면 `apply_get_key` 로 다시 시도한다. 그래도 안 되면 사용자가 마이페이지에서 복사해 `save_key` 로 저장한다.
- 자동승인 API 는 보통 1~2시간 뒤부터 호출 가능하다. `my_applications` 로 승인 여부 확인.

## 4. 호출

- `call_api { url 또는 endpoint, params }` — 키는 자동으로 붙는다. **`serviceKey` 를 params 에 넣지 않는다.** (GET 전용)
- 서비스 키는 기본적으로 공공데이터 호스트(data.go.kr, *.go.kr, *.or.kr)로만 전송된다. 다른 호스트는 `DATAGO_ALLOWED_HOSTS` 로 허용해야 한다.
- 목록이 길면 `itemsOnly: true` (토큰 절약) 또는 `fetch_all { maxPages }` (전 페이지 순회).
- 수백 건 이상이면 컨텍스트에 싣지 말고 `export_data { ..., format: "csv" }` 로 파일에 저장한 뒤 경로만 알려준다.
- 같은 조회를 반복할 가능성이 있으면 `call_api` 에 `cacheSeconds` 를 줘서 트래픽을 아낀다.
- 자주 쓰는 주소는 `save_endpoint` 로 별칭 등록해 두면 다음부터 `endpoint` 로 부른다.
- 대량 호출 전 `quota_status` 로 오늘 호출량을 확인한다 (개발계정은 보통 일 1,000회).

## 에러 해석

응답 `summary.hint` 필드가 조치 방법을 알려준다. 더 필요하면 `explain_error { code }`.

| resultCode | 의미 | 할 일 |
|---|---|---|
| 03 | 데이터 없음 | 파라미터 범위를 넓힌다 |
| 10 / 11 / 12 | 파라미터 오류 / 필수 누락 / 주소 오류 | `describe_api` 로 재확인 |
| 20 | 활용신청 미승인 | `my_applications` 로 승인 상태 확인 |
| 22 | 트래픽 초과 | 내일 재시도, 증설 신청 |
| 30 | 키 미등록 | 승인 대기·키 오타 확인 (인코딩은 자동 보정됨) |

## 하지 말 것

- 사용자의 포털 비밀번호를 묻거나 저장하지 않는다. 로그인은 사용자가 창에서 직접 한다.
- 키 전체를 응답/로그에 그대로 출력하지 않는다 (`list_keys` 는 마스킹된다).
- 일괄 신청은 사용자가 요청한 범위로만 한다.
- 키 원문을 응답에 옮겨 적지 않는다 (`apply_api`/`apply_get_key` 는 마스킹된 값만 돌려준다).
