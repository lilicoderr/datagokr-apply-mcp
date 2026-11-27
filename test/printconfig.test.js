import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSnippet, formatPrintConfig, desktopConfigPath } from '../src/printconfig.js';

const opts = { script: '/opt/dg/bin/server.js', platform: 'linux', env: {}, home: '/home/u' };

test('claude-desktop snippet is valid JSON with mcpServers', () => {
  const s = buildSnippet('claude-desktop', opts);
  assert.deepEqual(JSON.parse(s.content).mcpServers.datagokr, { command: 'node', args: ['/opt/dg/bin/server.js'] });
  assert.match(s.file, /claude_desktop_config\.json$/);
});

test('claude-code snippet quotes paths with spaces', () => {
  assert.equal(buildSnippet('claude-code', { ...opts, script: '/a b/s.js' }).content, 'claude mcp add datagokr -- node "/a b/s.js"');
});

test('desktop path per platform', () => {
  assert.match(desktopConfigPath('win32', { APPDATA: 'C:\A' }, 'C:\h'), /Claude/);
  assert.match(desktopConfigPath('darwin', {}, '/Users/u'), /Application Support/);
});

test('unknown client throws; all prints three', () => {
  assert.throws(() => buildSnippet('vim', opts), /알 수 없는/);
  assert.match(formatPrintConfig('all', opts), /cursor/);
});

test('CLI --print-config exits 0 and contains no key material', () => {
  const bin = fileURLToPath(new URL('../bin/server.js', import.meta.url));
  const r = spawnSync(process.execPath, [bin, '--print-config', 'cursor'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /mcpServers/);
  assert.equal(spawnSync(process.execPath, [bin, '--print-config', 'vim'], { encoding: 'utf8' }).status, 2);
});
