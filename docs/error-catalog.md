# Error catalog

> Generated from `src/datago.js` by `npm run docs:errors`. Do not edit by hand.

data.go.kr returns errors as **HTTP 200** with a `resultCode` in the body, so always check the code, not just the status.

## resultCode

| Code | Meaning | Auto-retried | What to do |
|---|---|---|---|
| `00` | 정상 | no | - |
| `01` | 어플리케이션 에러 | yes (backoff) | 포털/기관 서버 내부 오류예요. 잠시 후 다시 시도하세요(자동 재시도했어요). |
| `02` | DB 에러 | yes (backoff) | 기관 DB 오류예요. 잠시 후 다시 시도하세요. |
| `03` | 데이터 없음 | no | 조건에 맞는 데이터가 없어요. 날짜·지역코드 등 파라미터 범위를 넓혀 보세요. |
| `04` | HTTP 에러 | no | - |
| `05` | 서비스 연결 실패(타임아웃) | yes (backoff) | 기관 서버가 응답하지 않아요. 잠시 후 다시 시도하세요. |
| `10` | 잘못된 요청 파라미터 | no | 파라미터 형식이 틀렸어요. 해당 API 의 요청 변수 표(타입/자리수)를 확인하세요. |
| `11` | 필수 요청 파라미터 누락 | no | 필수 파라미터가 빠졌어요. 오픈API 상세 페이지의 "필수" 항목을 모두 넣었는지 보세요. |
| `12` | 해당 오픈API 서비스가 없거나 폐기됨 | no | URL 이 틀렸거나 폐기된 API 예요. 포털 상세 페이지의 최신 요청 주소를 확인하세요. |
| `20` | 서비스 접근 거부 (활용신청 미승인/중지) | no | 활용신청이 승인되지 않았어요. my_applications 로 승인 상태를 확인하고, 자동승인 API 라도 1~2시간 걸릴 수 있어요. |
| `21` | 일시적으로 사용할 수 없는 서비스 키 | no | 키가 일시적으로 사용 불가예요. 잠시 후 다시 시도하세요. |
| `22` | 서비스 요청 제한 횟수 초과 | no | 일일 트래픽 한도를 넘겼어요. 내일 다시 하거나 포털에서 트래픽 증설을 신청하세요. (quota_status 로 오늘 호출량 확인) |
| `30` | 등록되지 않은 서비스 키 (키 오타 또는 이중 인코딩 의심) | no | 등록되지 않은 키예요. 키 오타, 승인 대기(활용신청 직후 1~2시간), 다른 API 의 키 사용 여부를 확인하세요. (doctor 로 점검) |
| `31` | 활용 기간 만료 | no | 활용 기간이 만료됐어요. 포털에서 연장 신청을 하세요. |
| `32` | 등록되지 않은 IP | no | 호출 IP 가 등록된 IP 가 아니에요. 포털 개발계정 설정에서 IP 를 확인하세요. |
| `33` | 서명되지 않은 호출 | no | 서명이 필요한 API 예요. 포털 상세 페이지의 호출 방법을 확인하세요. |
| `99` | 기타 오류 | no | - |
| `ERROR-300` | 필수 값 누락 | no | 필수 값이 빠졌어요. describe_api 의 [필수] 항목을 확인하세요. |
| `ERROR-310` | 해당하는 서비스를 찾을 수 없음 | no | - |
| `ERROR-336` | 데이터 요청은 한 번에 최대 1,000건까지 | no | - |
| `ERROR-500` | 서버 오류 | no | - |
| `INFO-100` | 인증키가 유효하지 않음 | no | 인증키가 유효하지 않아요. 서울 열린데이터광장 등 기관 자체 키가 필요한 API 일 수 있어요(공공데이터포털 키가 아님). |
| `INFO-200` | 해당하는 데이터가 없음 | no | 조건에 맞는 데이터가 없어요. 범위를 넓혀 보세요. |

## Transport-level conditions

| Condition | Behavior |
|---|---|
| HTTP 429 / 5xx, network error, timeout | Retried with exponential backoff (base 500 ms, max 8 s, 2 retries) |
| resultCode `30` | Retried once with the opposite key encoding (Encoding vs Decoding) |
| Consecutive failures on one host | Per-host circuit breaker opens (5 failures, 30 s cooldown) and calls fail fast with `CircuitOpenError` |
