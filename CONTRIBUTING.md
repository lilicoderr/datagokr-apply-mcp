# 기여하기

이슈와 PR 모두 환영합니다. 작은 수정도 좋아요.

## 개발 환경

```bash
git clone https://github.com/lilicoderr/datagokr-apply-mcp.git
cd datagokr-apply-mcp
npm test                       # Node 20+ — 런타임 의존성 없음
npm ci && npm run typecheck    # 타입 검사에만 개발 의존성이 필요
node bin/server.js doctor      # 환경 점검
```

활용신청 자동화 쪽을 만질 때만 `npm install playwright-core && npx playwright-core install chromium` 이 필요합니다.

## 원칙

1. **런타임 의존성을 늘리지 않습니다.** 핵심은 Node 내장 모듈만 씁니다. (`playwright-core` 는 선택 의존성)
2. **네트워크 없이 테스트됩니다.** `fetch` 는 주입(`fetchImpl`)하고, 포털 HTML 은 `test/fixtures/` 의 실제 페이지 조각으로 검증합니다.
3. **파싱은 순수 함수로.** 포털 HTML 의존 코드(`src/portal.js`, 신청 결과 판정 등)는 입출력이 분명한 함수로 두고 테스트를 붙입니다. 포털이 바뀌면 fixture 와 해당 함수만 고치면 되게요.
4. **도구 설명은 AI 가 읽습니다.** 새 도구의 `description` 에는 *언제 쓰는지*와 *다음에 뭘 하면 되는지*를 적어주세요.
5. **비밀을 다루지 않습니다.** 비밀번호·쿠키·서비스 키가 로그, 응답, 테스트 fixture, 커밋에 들어가면 안 됩니다.

## 포털 구조가 바뀌어 깨졌을 때

1. 해당 페이지를 저장해 필요한 부분만 잘라 `test/fixtures/` 에 둡니다 (개인정보가 없는 공개 페이지만).
2. 실패하는 테스트를 먼저 만들고 → 파서를 고칩니다.
3. 가능하면 이슈에 포털의 변경 내용을 한두 줄로 적어주세요.

## 커밋 · PR

- 커밋은 작게, 메시지는 `feat:` `fix:` `docs:` `test:` `ci:` `refactor:` 접두어를 씁니다.
- 동작이 바뀌면 `CHANGELOG.md` 의 *Unreleased* 항목에 한 줄 추가해 주세요.
- PR 전에 `npm test` 가 통과해야 합니다. (CI 는 Node 20/22 × Linux/Windows)

## 버그 신고

`node bin/server.js doctor` 출력을 붙여주시면 원인 파악이 빨라집니다. 키·쿠키가 보이지 않는지 확인 후 올려주세요.
