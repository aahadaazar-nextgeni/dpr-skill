const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

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

test('uses standard configuration defaults', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dpr-config-'));
  const config = helper.loadConfig(repo);
  assert.deepEqual(config.sections, ['tasks', 'summary', 'notes', 'commits']);
  assert.equal(config.mode, 'standard');
  assert.equal(config.sources.commits, true);
  assert.equal(config.limits.maxCommits, null);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('short mode supplies compact defaults', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dpr-short-'));
  const config = helper.loadConfig(repo, { short: true });
  assert.deepEqual(config.sections, ['tasks', 'summary']);
  assert.equal(config.mode, 'short');
  assert.equal(config.limits.summarySentences, 2);
  assert.equal(config.limits.taskDescriptionSentences, 1);
  assert.equal(config.limits.maxNotes, 1);
  assert.equal(config.limits.maxCommits, 3);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('repository configuration overrides defaults and is respected in short mode', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dpr-config-'));
  fs.writeFileSync(path.join(repo, '.dprrc.json'), JSON.stringify({
    version: 1,
    sections: ['summary', 'tasks', 'commits'],
    sources: { otherRepositories: false },
    limits: { maxNotes: 2, maxCommits: 8 },
  }));
  const config = helper.loadConfig(repo, { short: true });
  assert.deepEqual(config.sections, ['summary', 'tasks', 'commits']);
  assert.equal(config.sources.otherRepositories, false);
  assert.equal(config.limits.maxNotes, 2);
  assert.equal(config.limits.maxCommits, 8);
  assert.equal(config.limits.summarySentences, 2);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('loads and validates an in-repository custom template', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dpr-template-'));
  fs.writeFileSync(path.join(repo, '.dpr-template.md'), '# {{repository}} — {{date}}\n\n{{summary}}\n\n{{tasks}}\n');
  fs.writeFileSync(path.join(repo, '.dprrc.json'), JSON.stringify({ version: 1, template: '.dpr-template.md' }));
  const config = helper.loadConfig(repo);
  assert.equal(config.template.path, '.dpr-template.md');
  assert.match(config.template.content, /{{summary}}/);
  fs.writeFileSync(path.join(repo, 'bad-template.md'), '{{unknown}}');
  fs.writeFileSync(path.join(repo, '.dprrc.json'), JSON.stringify({ template: 'bad-template.md' }));
  assert.throws(() => helper.loadConfig(repo), /unsupported placeholder/);
  fs.writeFileSync(path.join(repo, '.dprrc.json'), JSON.stringify({ template: '../outside.md' }));
  assert.throws(() => helper.loadConfig(repo), /inside the repository/);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('rejects malformed or unsupported repository configuration', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dpr-invalid-'));
  fs.writeFileSync(path.join(repo, '.dprrc.json'), '{');
  assert.throws(() => helper.loadConfig(repo), /Could not parse/);
  fs.writeFileSync(path.join(repo, '.dprrc.json'), JSON.stringify({ sections: ['unknown'] }));
  assert.throws(() => helper.loadConfig(repo), /unsupported section/);
  fs.writeFileSync(path.join(repo, '.dprrc.json'), JSON.stringify({ limits: { maxNotes: -1 } }));
  assert.throws(() => helper.loadConfig(repo), /non-negative integer/);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('collects a temporary Git repository using the configured sources', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dpr-repo-'));
  const git = (args, env = {}) => execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  git(['init', '-q']);
  git(['config', 'user.name', 'DPR Test']);
  git(['config', 'user.email', 'dpr-test@example.com']);
  fs.writeFileSync(path.join(repo, 'work.txt'), 'done\n');
  git(['add', 'work.txt']);
  git(['commit', '-q', '-m', 'Complete DPR integration test'], {
    GIT_AUTHOR_DATE: '2026-08-12T12:00:00',
    GIT_COMMITTER_DATE: '2026-08-12T12:00:00',
  });
  fs.writeFileSync(path.join(repo, '.dprrc.json'), JSON.stringify({
    version: 1,
    sources: {
      pullRequests: false,
      claudeSessions: false,
      workingTree: false,
      otherRepositories: false,
    },
  }));
  const configOutput = execFileSync(process.execPath, [
    path.resolve(__dirname, '../skills/dpr/scripts/dpr.js'),
    'config', '--repo-root', repo, '--short',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const configured = JSON.parse(configOutput);
  assert.equal(configured.reportConfig.mode, 'short');
  assert.deepEqual(configured.reportConfig.sections, ['tasks', 'summary']);
  const result = helper.collect({ date: '2026-08-12', repoRoot: repo, env: { CLAUDE_CONFIG_DIR: path.join(repo, '.claude-state') } });
  assert.equal(result.hasActivity, true);
  assert.equal(result.commits.length, 1);
  assert.equal(result.github.pullRequests.length, 0);
  assert.equal(result.sessions.sessions.length, 0);
  assert.equal(result.workingTree, null);
  assert.equal(result.lastWorkedDate, null);
  const noActivity = helper.collect({
    date: '2026-08-13',
    repoRoot: repo,
    env: { CLAUDE_CONFIG_DIR: path.join(repo, '.claude-state') },
  });
  assert.equal(noActivity.hasActivity, false);
  assert.equal(noActivity.lastWorkedDate, '2026-08-12');
  fs.rmSync(repo, { recursive: true, force: true });
});

test('installer always targets the current repository', () => {
  assert.equal(installer.destination('/repo'), path.join('/repo', '.claude', 'skills', 'dpr'));
  assert.throws(() => installer.parse(['--global']), /repository-local/);
  assert.throws(() => installer.parse(['--project']), /repository-local/);
});
