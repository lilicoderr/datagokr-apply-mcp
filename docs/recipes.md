# Recipes

Five end-to-end workflows. Each shows what you can say to Claude and which tools run underneath. Examples use real data.go.kr service families; check `describe_api` for the exact current URL and parameters before relying on them.

Contents: [1. Public holidays](#1-public-holidays-for-a-calendar-app) · [2. Air quality](#2-air-quality-snapshot) · [3. Bus arrivals](#3-bus-arrival-times) · [4. Excel export](#4-export-a-whole-dataset-to-excel) · [5. Quota-safe daily job](#5-quota-safe-daily-job)

---

## 1. Public holidays for a calendar app

> "Find the Korean public-holiday API, apply for it, and get 2026's holidays."

1. `search_datasets { query: "공휴일 특일 정보" }` — candidates (the KASI 특일 정보 API, id `15012690`, is usually first).
2. `describe_api { idOrUrl: "15012690" }` — shows the `getRestDeInfo` operation, required `solYear`, optional `solMonth`.
3. No key yet? `apply_status` → `apply_login` (once) → `apply_api { idOrUrl: "15012690" }` — applies and saves the key automatically.
4. `save_endpoint { alias: "holidays", url: "…/SpcdeInfoService/getRestDeInfo", params: { numOfRows: 50 } }`
5. `call_api { endpoint: "holidays", params: { solYear: 2026 }, itemsOnly: true, cacheSeconds: 86400 }`

Tip: holidays change rarely, so `cacheSeconds` saves quota.

## 2. Air quality snapshot

> "What is PM2.5 in Seoul right now? Use my saved key."

1. `search_datasets { query: "에어코리아 대기오염정보" }` → `describe_api` on the 측정소별 실시간 측정정보 조회 API.
2. `call_api { …, itemsOnly: true, maxItems: 1 }` for the latest row. Sensor APIs return `-` for outages, so handle that in code.

## 3. Bus arrival times

> "Apply for the bus-arrival API, then tell me when bus 143 reaches stop X."

1. `find_apply_targets { keyword: "버스도착정보" }` — lists REST APIs that are auto-approvable.
2. `apply_status` → `apply_api { idOrUrl: "<id>" }` (opens a browser once for login; see the README on auto-apply).
3. Approval is usually instant; if you get resultCode `30` right after, wait 1–2 hours.
4. `call_api` with the stop ID from the lookup operation, `itemsOnly: true`.

If the host is down, the per-host circuit breaker fails fast instead of waiting out retries; try again after about 30 seconds.

## 4. Export a whole dataset to Excel

> "Download all pharmacies in Busan as a spreadsheet."

1. Find and describe the API as above.
2. `export_data { endpoint: "pharmacy", params: { sido: "부산" }, format: "csv", maxPages: 50, numOfRows: 100, filename: "busan-pharmacy" }`
3. The file is written inside the export folder (`DATAGO_EXPORT_DIR`, default `~/datago-exports`) with a UTF-8 BOM so Excel shows Korean correctly. Only the path comes back, so the rows never fill the model's context.

Cells starting with `=`, `+`, `-` or `@` are prefixed with `'` to prevent formula injection.

## 5. Quota-safe daily job

> "Collect yesterday's data without burning the 1,000-call daily quota."

1. `quota_status` — today's usage per key.
2. Call `call_api` once per param set (or `fetch_all` / `export_data` for paged results); resultCode `22` means the quota is exhausted.
3. Use `cacheSeconds` for lookups that repeat, and the `datago://usage` MCP resource to watch usage without spending a tool call.

Pair it with the `find-and-call-api` MCP prompt to let a new teammate discover and call an API without learning the tool names.
