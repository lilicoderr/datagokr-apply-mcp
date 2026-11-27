// 공용 JSDoc 타입 정의 (tsc --noEmit + checkJs 용, 런타임 코드 없음).

/**
 * 도구 핸들러에 넘어가는 두 번째 인자 (src/mcp.js 의 makeContext).
 * @typedef {object} ToolContext
 * @property {string|number|undefined} requestId JSON-RPC 요청 id
 * @property {AbortSignal} signal notifications/cancelled 로 중단되면 aborted
 * @property {(progress: number, total?: number, message?: string) => boolean} progress notifications/progress 전송
 */

/**
 * 도구 결과. structuredContent 는 outputSchema 가 있는 도구에서 함께 돌려준다.
 * @typedef {object} ToolResult
 * @property {Array<{type: string, text?: string}>} content
 * @property {Record<string, any>} [structuredContent]
 * @property {boolean} [isError]
 */

/**
 * @typedef {object} ToolAnnotations
 * @property {boolean} [readOnlyHint]
 * @property {boolean} [destructiveHint]
 * @property {boolean} [idempotentHint]
 * @property {boolean} [openWorldHint]
 */

/** @typedef {(url: string, init?: RequestInit) => Promise<Response>} FetchImpl 주입 가능한 fetch */

/** 옵션 가방(키가 많고 선택적인 객체). 세부 키는 각 함수 위 주석 참고. @typedef {Record<string, any>} Options */

export {};
