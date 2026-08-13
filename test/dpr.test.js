const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const helper = require('../skills/dpr/scripts/dpr.js');
const installer = require('../bin/dpr-install.js');

test('validates ISO dates without relying on shell date flags', () => {
  assert.equal(helper.validateDate('2026-08-12'), '2026-08-12');
  assert.throws(() => helper.validateDate('2026-02-30'), /Invalid calendar date/);
  assert.throws(() => helper.validateDate('today'), /Invalid date/);
});

test('builds Claude project keys for POSIX and Windows paths', () => {
  assert.equal(helper.projectKey('/home/alice/project'), '-home-alice-project');
  assert.equal(helper.projectKey('C:\\Users\\Alice\\project'), 'C--Users-Alice-project');
});

test('uses platform-aware report paths', () => {
  const result = helper.reportPath('/tmp/example', '2026-08-12', { CLAUDE_CONFIG_DIR: '/config' });
  assert.equal(result, path.join('/config', 'daily-reports', 'example', '2026-08-12.md'));
});

test('extracts only user and assistant text from transcript records', () => {
  assert.deepEqual(
    helper.sessionText({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }, { type: 'tool_use' }] } }),
    { role: 'assistant', text: 'Done', timestamp: null },
  );
  assert.equal(helper.sessionText({ type: 'system', content: 'ignore' }), null);
  assert.equal(helper.sessionText({ type: 'user', isMeta: true, content: 'ignore' }), null);
});

test('installer always targets the current repository', () => {
  assert.equal(installer.destination('/repo'), path.join('/repo', '.claude', 'skills', 'dpr'));
  assert.throws(() => installer.parse(['--global']), /repository-local/);
  assert.throws(() => installer.parse(['--project']), /repository-local/);
});
