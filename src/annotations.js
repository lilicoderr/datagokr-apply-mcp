import { attachOutputSchemas } from './outputs.js';

// MCP 도구 annotations (readOnlyHint / destructiveHint / idempotentHint / openWorldHint).
// 스펙상 힌트일 뿐 보안 경계가 아니다. 클라이언트가 확인창·자동승인 정책에 참고한다.
//   ro   : 환경을 바꾸지 않음           (readOnlyHint)
//   idem : 같은 인자로 반복해도 결과 동일 (idempotentHint, ro 가 아닐 때만 의미)
//   dest : 기존 데이터를 지우거나 덮어씀   (destructiveHint, ro 가 아닐 때만 의미)
//   open : 외부(인터넷·포털)와 상호작용   (openWorldHint)
const R = { ro: true, open: false };
const NET = { ro: true, open: true };
const W = { ro: false, dest: false, idem: true, open: false };

export const TOOL_ANNOTATIONS = {
  call_api: NET, fetch_all: NET, batch_call: NET, describe_api: NET, api_types: NET, infer_schema: NET,
  find_apply_targets: NET, search_datasets: NET, recommend_datasets: NET,
  export_data: { ro: false, dest: true, idem: false, open: true }, // 같은 이름 파일을 덮어쓸 수 있음
  quota_status: R, list_keys: R, list_endpoints: R, explain_error: R, list_error_codes: R, apply_guide: R,
  apply_setup: R, doctor: R, apply_status: { ro: true, open: true }, geo: R,
  save_key: { ...W, dest: true }, remove_key: { ro: false, dest: true, idem: true, open: false },
  set_default_key: W, save_endpoint: { ...W, dest: true }, remove_endpoint: { ro: false, dest: true, idem: true, open: false },
  apply_login: { ro: false, dest: false, idem: true, open: true },
  apply_api: { ro: false, dest: false, idem: true, open: true }, // 이미 신청된 건은 건너뜀
  apply_apis: { ro: false, dest: false, idem: true, open: true },
  my_applications: { ro: true, open: true },
  dataset_watch: { ro: false, dest: false, idem: true, open: true }, // 스냅샷 파일 갱신
};

export function annotationsFor(name) {
  const a = TOOL_ANNOTATIONS[name];
  if (!a) return undefined;
  const out = { readOnlyHint: a.ro, openWorldHint: a.open };
  if (!a.ro) { out.destructiveHint = Boolean(a.dest); out.idempotentHint = Boolean(a.idem); }
  return out;
}

// 이미 등록된 도구에 annotations 를 붙인다 (명시된 값은 덮어쓰지 않음)
export function annotateTools(server) {
  attachOutputSchemas(server); // outputSchema 도 같은 시점에 붙인다
  for (const [name, entry] of server.tools) {
    if (!entry.def.annotations) {
      const a = annotationsFor(name);
      if (a) entry.def.annotations = a;
    }
  }
  return server;
}
