<div align="center">

# datagokr-apply-mcp

**An MCP server that lets Claude search, apply for, and call Korea's open-data APIs (data.go.kr) on its own.**

[![CI](https://github.com/lilicoderr/datagokr-apply-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/lilicoderr/datagokr-apply-mcp/actions/workflows/ci.yml)
[![Security](https://github.com/lilicoderr/datagokr-apply-mcp/actions/workflows/security.yml/badge.svg)](https://github.com/lilicoderr/datagokr-apply-mcp/actions/workflows/security.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)
![Dependencies](https://img.shields.io/badge/runtime%20deps-0-brightgreen)
![MCP](https://img.shields.io/badge/MCP-stdio%20JSON--RPC%202.0-8A2BE2)

**English** · [한국어](README.ko.md)

[Quick start](#quick-start) · [Tools](#tools-27) · [Recipes](docs/recipes.md) · [Error catalog](docs/error-catalog.md) · [Auto-apply](#auto-apply-for-api-keys) · [Security](#security) · [FAQ](#faq) · [Contributing](CONTRIBUTING.md)

</div>

---

> "Find a bus-arrival API, apply for it, then call it for tomorrow's schedule."
>
> Key issuance, double URL-encoding, XML parsing, daily quotas — Claude gets past every spot where Korean open-data APIs usually trip people up.

## Why

data.go.kr (the Korean public data portal) makes you do a lot by hand before the first call, and the API itself has sharp edges.

| Pain point | What this server does |
|---|---|
| Search → detail → **apply → wait for approval → copy key**, all by clicking | **Submits the application for you** through browser automation (batch supported) |
| Service key **double-encoding** → `SERVICE_KEY_IS_NOT_REGISTERED (30)` | Detects the key form and **retries once with the other form** on code 30 |
| Errors come back as **HTTP 200**; responses are JSON or XML at random | Parses both and turns `resultCode` into **a plain explanation plus a fix** |
| Guessing parameters → `resultCode 10/11/12` | `describe_api` shows **URL, required params, response fields** first |
| Transient failures (5xx, timeouts) | **Exponential-backoff retries** |
| Results span many pages | `fetch_all` / `export_data` **walk every page** |
| Daily quota (usually 1,000 calls) | `quota_status` estimates today's usage; `cacheSeconds` avoids repeat calls |

There are **zero runtime dependencies**: it uses Node's built-in `fetch` and implements the MCP protocol itself. Only the optional auto-apply feature needs `playwright-core`.

## Demo

A sample conversation (tool output abbreviated):

```text
You     ▸ Find the public-holiday API and tell me how to call it

Claude  ▸ search_datasets { query: "특일 정보" }
        ▸ describe_api { idOrUrl: "15012690" }
          URL: …/SpcdeInfoService/getAnniversaryInfo
          [required] pageNo, numOfRows, solYear   [optional] solMonth
        ▸ apply_status → apply_api { idOrUrl: "15012690" }   # no key yet? applies automatically
        ▸ call_api { endpoint: "holidays", params: { solYear: 2025, solMonth: "05" }, itemsOnly: true }
          ok · resultCode 00 · key encoding: Decoding · 1 attempt
```

Real output of `describe_api` (portal page 15012690, field values are Korean as served by the portal):

```jsonc
{
  "제목": "한국천문연구원_특일 정보",
  "트래픽": "개발계정 : 10,000 / 운영계정 : 활용사례 등록시 신청하면 트래픽 증가 가능",
  "요청주소": "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getAnniversaryInfo",
  "상세기능": ["기념일 정보 조회", "공휴일 정보 조회", "국경일 정보조회", "24절기 정보 조회", "잡절 정보 조회"],
  "요청변수": ["[필수] pageNo(페이지 번호) 예:1", "[필수] solYear(연) 예:2019", "[선택] solMonth(월) 예:02"]
}
```

> Tool descriptions and result fields are in Korean on purpose: the portal, its error messages and its users are Korean, and the model reads them directly.

## Quick start

**You need:** Node.js 20+ and, only for auto-apply, a data.go.kr account.

```bash
git clone https://github.com/lilicoderr/datagokr-apply-mcp.git
cd datagokr-apply-mcp
node bin/server.js doctor          # environment check (no install needed)
node bin/server.js doctor --fix    # also repairs what it safely can
```

### Any client: `--print-config`

```bash
node bin/server.js --print-config            # snippets for Claude Desktop, Claude Code and Cursor
node bin/server.js --print-config cursor     # just one (paths are filled in; no secrets are printed)
```

### Claude Code

```bash
claude mcp add datagokr -- node /absolute/path/to/datagokr-apply-mcp/bin/server.js
```

Or a project-level `.mcp.json` ([example](.mcp.json.example)):

```json
{
  "mcpServers": {
    "datagokr": { "command": "node", "args": ["/absolute/path/to/datagokr-apply-mcp/bin/server.js"] }
  }
}
```

### Claude Desktop

Add the same entry under `mcpServers` in `claude_desktop_config.json`.

### Claude Code skill (optional)

Copy [`skills/datagokr/SKILL.md`](skills/datagokr/SKILL.md) to `~/.claude/skills/datagokr/`. Claude will then follow **search → read spec → apply → call** whenever you ask for a public-data API.

## Tools (27)

**Explore and call** — no login needed

| Tool | What it does |
|---|---|
| `search_datasets` | Keyword search for open APIs (title, category, provider, summary, application count) |
| `find_apply_targets` | Keeps only **auto-approved REST** APIs and returns their ids (public pages, no browser) |
| `describe_api` | Data id → **request URL, required/optional params, response fields, traffic limit** |
| `api_types` | Spec → **TypeScript interfaces** for params, items and the response envelope |
| `call_api` | Calls an API: auto key, double-encoding fix, JSON/XML parsing, retries, `itemsOnly`, `cacheSeconds` (TTL cache to save quota) |
| `fetch_all` | Walks every page and returns the merged items (`maxPages` cap) |
| `export_data` | Saves the full result as **CSV (Excel-safe BOM) or JSON** and returns only the path — keeps big datasets out of the model's context |
| `recommend_datasets` | Natural-language request → several portal searches → **ranked candidates** |
| `infer_schema` | Live sample → per-field **types, missing rate, enums** |
| `batch_call` | Calls one API with many param sets, throttled, max 50, optional stop-on-error |
| `quota_status` | Today's (KST) per-key call count and estimated remaining quota |
| `explain_error` · `list_error_codes` | `resultCode` → plain explanation |

**Keys and aliases**

| Tool | What it does |
|---|---|
| `save_key` · `list_keys` · `remove_key` · `set_default_key` | Manage service keys (Encoding or Decoding form both work) |
| `save_endpoint` · `list_endpoints` · `remove_endpoint` | Store frequent URLs as aliases with default params |

**Auto-apply** — needs `playwright-core` and a login session

| Tool | What it does |
|---|---|
| `apply_login` | Opens a login window (non-blocking, password never stored) |
| `apply_status` | Checks that the login session is still valid |
| `apply_api` | Submits one application |
| `apply_apis` | Batch apply (one shared browser, de-duplicated, stops at once if logged out) |
| `my_applications` | Application status (pending/approved/rejected, counted) |

**Diagnostics**

| Tool | What it does |
|---|---|
| `doctor` | Checks Node, keys, network, browser, session and usage, and says how to fix each (CLI: `doctor`, `doctor --fix`) |
| `apply_guide` | Manual application walkthrough |

## Auto-apply for API keys

```bash
npm install playwright-core                 # only if you want auto-apply
npx playwright-core install chromium        # bundled Chromium; your own browser is untouched
node bin/server.js doctor --fix             # should be all green
```

The flow Claude follows (each tool's description says what to do next):

1. `apply_status` — am I logged in?
2. If not, `apply_login` — **opens a window and returns immediately**. You only **log in by hand**. The session is saved every few seconds and the window closes once `apply_status` confirms it (usually a one-time step).
3. `find_apply_targets` → `apply_api` / `apply_apis` — submit applications.
4. `my_applications` to confirm approval → `save_key` → `call_api`.

> Auto-apply works for **individual accounts and REST-type, auto-approved APIs**. LINK-type (external) and corporate-only APIs report "could not open the application form". Verified by applying for and getting 11 individual auto-approval APIs approved.

You can also get a key by hand: log in → **활용신청** on the API page → My page › Development account › **General auth key** → `save_key`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATAGO_CONFIG` | `~/.datago-mcp.json` | Stored keys and endpoints ([example](config.example.json)) |
| `DATAGO_USAGE` | `~/.datago-usage.json` | Call counts (key names only, never key values) |
| `DATAGO_EXPORT_DIR` | `~/datago-exports` | Where `export_data` writes (it never writes outside this folder) |
| `DATAGO_HOME` | `~/.datagokr-mcp` | Login-session (cookie) folder |
| `DATAGO_STATE` | `$DATAGO_HOME/storage-state.json` | Explicit session file path |
| `DATAGO_DEBUG` | off | `1` = debug logs to stderr (service key, cookies and stored keys masked as `***`) |
| `DATAGO_LOG_LEVEL` / `DATAGO_LOG_FORMAT` | off / `json` | `error\|warn\|info\|debug`; `text` for plain lines |
| `DATAGO_ALLOWED_HOSTS` | (any public host) | Comma-separated domains `call_api` may contact |
| `DATAGO_ALLOW_LOCAL` | off | `1` allows loopback/private targets (blocked by default) |

## Security

- **Passwords are never received, stored or logged.** You log in yourself in the browser.
- Only the session cookie is kept, in your **home folder** (`~/.datagokr-mcp/`, outside the repo) and listed in `.gitignore`, so it cannot be committed.
- The key file is written **atomically** (an interrupted write cannot corrupt it) with `0600` permissions on POSIX. A corrupt file is **backed up first**, so keys never vanish silently.
- `list_keys` and `doctor` mask keys; the usage file holds no key values.
- `export_data` writes only inside the export folder, and CSV cells that start with `=`, `+`, `-` or `@` are neutralised against spreadsheet formula injection.
- CI scans the full git history for committed credentials and runs `npm audit` weekly.
- Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## FAQ

<details>
<summary><b>I keep getting resultCode 30 (SERVICE_KEY_IS_NOT_REGISTERED)</b></summary>

1. Right after applying, approval can take 1–2 hours. 2. Make sure the key belongs to this API. 3. The server already retries with the other Encoding/Decoding form, so a persistent 30 means a key problem. Run `node bin/server.js doctor`.
</details>

<details>
<summary><b>The apply_* tools are missing</b></summary>

Without `playwright-core` only those tools are disabled and `apply_setup` explains why. Run `npm install playwright-core && npx playwright-core install chromium` (or `doctor --fix`), then restart the server.
</details>

<details>
<summary><b>I hit the daily quota (22)</b></summary>

Development accounts usually get 1,000 calls/day (it varies by API), reset at midnight KST. `quota_status` shows today's calls through this server, and `cacheSeconds` on `call_api` avoids repeat calls. Registering a use case lets you request a higher production quota.
</details>

<details>
<summary><b>What if the portal changes its HTML?</b></summary>

Search, spec and apply rely on portal HTML. The parsers are pure functions ([`src/portal.js`](src/portal.js)) tested against real captured fixtures, so a break means refreshing the fixture and fixing one function. Please open an issue.
</details>

## Layout

```
datagokr-apply-mcp/
├─ bin/server.js        stdio MCP entry · doctor · --version
├─ src/
│  ├─ mcp.js            MCP server (JSON-RPC 2.0 over stdio, no deps)
│  ├─ datago.js         calls · key encoding · resultCode mapping · backoff
│  ├─ items.js          normalises responses to items/paging (JSON/XML)
│  ├─ portal.js         portal detail/search page parsers
│  ├─ registry.js       key/endpoint store (atomic writes, corrupt-file backup)
│  ├─ usage.js          daily call counts (KST)
│  ├─ cache.js          TTL/LRU response cache
│  ├─ export.js         CSV/JSON export (path escape and formula injection guards)
│  ├─ hints.js          spec → TypeScript types
│  ├─ doctor.js         environment checks · --fix
│  ├─ xml.js            tiny XML → object parser
│  ├─ tools.js          call / explore / key tools
│  ├─ apply.js          auto-apply (Playwright)
│  └─ tools-apply.js    auto-apply tools
├─ skills/datagokr/     Claude Code skill
└─ test/                node:test (+ real-page fixtures)
```

## Development

```bash
npm test                              # everything runs offline (fetch is injected)
node --test --experimental-test-coverage
node bin/server.js doctor
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
