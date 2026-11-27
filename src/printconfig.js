// `--print-config` — MCP 클라이언트별 설치 스니펫을 출력한다 (키/비밀값은 포함하지 않음).

import os from 'node:os';
import path from 'node:path';

export const CLIENTS = ['claude-desktop', 'claude-code', 'cursor'];

function entry(script) {
  return { command: 'node', args: [script] };
}

export function desktopConfigPath(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Claude', 'claude_desktop_config.json');
}

/**
 * @param {any} client
 * @param {import('./types.js').Options} [options]
 */
export function buildSnippet(client, { script, platform, env, home } = {}) {
  if (!script) throw new Error('script 경로가 필요합니다.');
  const e = entry(script);
  switch (client) {
    case 'claude-desktop':
      return {
        client, file: desktopConfigPath(platform, env, home),
        note: '파일의 "mcpServers" 에 병합한 뒤 Claude Desktop 을 재시작하세요.',
        content: JSON.stringify({ mcpServers: { datagokr: e } }, null, 2),
      };
    case 'claude-code': {
      const q = (s) => (/\s/.test(s) ? `"${s}"` : s);
      return {
        client, file: null,
        note: '터미널에서 실행하세요. 프로젝트 공유용은 .mcp.json 에 같은 내용을 넣어도 됩니다.',
        content: `claude mcp add datagokr -- node ${q(script)}`,
      };
    }
    case 'cursor':
      return {
        client, file: path.join(home || os.homedir(), '.cursor', 'mcp.json'),
        note: '전역은 ~/.cursor/mcp.json, 프로젝트별은 <프로젝트>/.cursor/mcp.json 에 병합하세요.',
        content: JSON.stringify({ mcpServers: { datagokr: e } }, null, 2),
      };
    default:
      throw new Error(`알 수 없는 클라이언트: ${client} (${CLIENTS.join(' | ')} | all)`);
  }
}

export function formatPrintConfig(which, opts) {
  const list = !which || which === 'all' ? CLIENTS : [which];
  return list.map((c) => {
    const s = buildSnippet(c, opts);
    return `# ${c}${s.file ? `\n# 파일: ${s.file}` : ''}\n# ${s.note}\n${s.content}\n`;
  }).join('\n');
}
