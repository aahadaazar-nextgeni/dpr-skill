#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function validateDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date: ${value}. Use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime()) || localDate(parsed) !== value) {
    throw new Error(`Invalid calendar date: ${value}.`);
  }
  return value;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', options.allowStderr ? 'pipe' : 'ignore'],
    ...options,
  }).trim();
}

function tryRun(command, args) {
  try {
    return { ok: true, value: run(command, args) };
  } catch (error) {
    return { ok: false, error };
  }
}

function repoRoot(cwd = process.cwd()) {
  const result = tryRun('git', ['-C', cwd, 'rev-parse', '--show-toplevel']);
  if (!result.ok || !result.value) {
    throw new Error('The current directory is not inside a Git repository.');
  }
  return path.resolve(result.value);
}

function claudeHome(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function projectKey(repo) {
  const isWindowsAbsolute = /^[A-Za-z]:[\\/]/.test(repo);
  const absolute = isWindowsAbsolute ? repo : path.resolve(repo);
  return absolute.replace(/[\\/:]/g, '-');
}

function reportPath(repo, date, env = process.env) {
  return path.join(claudeHome(env), 'daily-reports', path.basename(repo), `${date}.md`);
}

function author() {
  const email = tryRun('git', ['config', 'user.email']);
  const name = tryRun('git', ['config', 'user.name']);
  return {
    email: email.ok ? email.value : '',
    name: name.ok ? name.value : '',
    selector: email.ok && email.value ? email.value : (name.ok ? name.value : ''),
  };
}

function commitStats(repo, hash) {
  const result = tryRun('git', ['-C', repo, 'show', '--format=', '--shortstat', hash]);
  return result.ok ? result.value.split(/\r?\n/).filter(Boolean).pop() || '' : '';
}

function collectCommits(repo, date, currentAuthor) {
  if (!currentAuthor.selector) return [];
  const args = [
    '-C', repo, 'log', '--all',
    `--since=${date} 00:00:00`, `--until=${date} 23:59:59`,
    `--author=${currentAuthor.selector}`,
    '--pretty=format:%H%x1f%h%x1f%ad%x1f%s', '--date=format:%H:%M', '--no-patch',
  ];
  const result = tryRun('git', args);
  if (!result.ok || !result.value) return [];
  return result.value.split(/\r?\n/).filter(Boolean).map((line) => {
    const [hash, shortHash, time, subject] = line.split('\x1f');
    return { hash, shortHash, time, subject, stats: commitStats(repo, hash) };
  });
}

function workingTree(repo, include) {
  if (!include) return null;
  const status = tryRun('git', ['-C', repo, 'status', '--porcelain=v1', '-uall']);
  const diff = tryRun('git', ['-C', repo, 'diff', '--stat', 'HEAD']);
  return {
    status: status.ok ? status.value.split(/\r?\n/).filter(Boolean) : [],
    diffStat: diff.ok ? diff.value : '',
  };
}

function ghActivity(date) {
  const user = tryRun('gh', ['api', 'user', '--jq', '.login']);
  if (!user.ok || !user.value) return { available: false, pullRequests: [] };
  const search = `author:${user.value} updated:${date}..${date}`;
  const prs = tryRun('gh', [
    'pr', 'list', '--search', search,
    '--json', 'number,title,url,state,updatedAt', '--limit', '100',
  ]);
  if (!prs.ok || !prs.value) return { available: true, pullRequests: [] };
  try {
    return { available: true, pullRequests: JSON.parse(prs.value) };
  } catch {
    return { available: true, pullRequests: [] };
  }
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function sessionText(record) {
  if (!record || record.isMeta || record.isSidechain) return null;
  const role = record.type === 'user' || record.type === 'assistant'
    ? record.type
    : record.message && record.message.role;
  if (role !== 'user' && role !== 'assistant') return null;
  const content = record.message ? record.message.content : record.content;
  const text = textFromContent(content);
  return text ? { role, text, timestamp: record.timestamp || null } : null;
}

function sessionFiles(projectsDir, repo, start, end) {
  const directory = path.join(projectsDir, projectKey(repo));
  if (!fs.existsSync(directory)) return { directory, files: [] };
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    const fullPath = path.join(directory, entry.name);
    const stats = fs.statSync(fullPath);
    if (stats.mtimeMs >= start && stats.mtimeMs <= end) files.push(fullPath);
  }
  return { directory, files };
}

function collectSessions(repo, date, env = process.env) {
  const start = new Date(`${date}T00:00:00`).getTime();
  const end = new Date(`${date}T23:59:59.999`).getTime();
  const found = sessionFiles(path.join(claudeHome(env), 'projects'), repo, start, end);
  const sessions = [];
  for (const file of found.files) {
    const messages = [];
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const message = sessionText(JSON.parse(line));
        if (!message) continue;
        if (message.timestamp) {
          const time = new Date(message.timestamp).getTime();
          if (Number.isFinite(time) && (time < start || time > end)) continue;
        }
        messages.push(message);
      } catch {
        // Ignore incomplete or future-format transcript lines.
      }
    }
    if (messages.length) sessions.push({ file: path.basename(file), messages });
  }
  return { directory: found.directory, sessions };
}

function otherActivity(repo, date, env = process.env) {
  const projectsDir = path.join(claudeHome(env), 'projects');
  if (!fs.existsSync(projectsDir)) return [];
  const start = new Date(`${date}T00:00:00`).getTime();
  const end = new Date(`${date}T23:59:59.999`).getTime();
  const current = projectKey(repo);
  const active = [];
  for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === current) continue;
    const directory = path.join(projectsDir, entry.name);
    let hasActivity = false;
    for (const file of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
      const modified = fs.statSync(path.join(directory, file.name)).mtimeMs;
      if (modified >= start && modified <= end) {
        hasActivity = true;
        break;
      }
    }
    if (hasActivity) active.push(entry.name);
  }
  return active;
}

function collect(options = {}) {
  const date = validateDate(options.date || localDate());
  const repo = repoRoot(options.repoRoot || process.cwd());
  const today = date === localDate();
  const currentAuthor = author();
  const commits = collectCommits(repo, date, currentAuthor);
  const sessions = collectSessions(repo, date, options.env || process.env);
  const github = ghActivity(date);
  const working = workingTree(repo, today);
  const other = otherActivity(repo, date, options.env || process.env);
  const hasActivity = commits.length > 0
    || sessions.sessions.length > 0
    || github.pullRequests.length > 0
    || Boolean(working && (working.status.length || working.diffStat));
  return {
    date,
    repo,
    repositoryName: path.basename(repo),
    reportPath: reportPath(repo, date, options.env || process.env),
    author: currentAuthor,
    commits,
    github,
    sessions,
    workingTree: working,
    otherRepositories: other,
    hasActivity,
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--date') options.date = argv[++index];
    else if (arg === '--repo-root') options.repoRoot = argv[++index];
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || rest.includes('--help') || rest.includes('-h')) {
    process.stdout.write('Usage: dpr.js collect [--date YYYY-MM-DD] [--repo-root PATH]\n');
    return;
  }
  if (command !== 'collect') throw new Error(`Unknown command: ${command}`);
  process.stdout.write(`${JSON.stringify(collect(parseArgs(rest)), null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  claudeHome,
  collect,
  localDate,
  projectKey,
  reportPath,
  sessionText,
  validateDate,
};
