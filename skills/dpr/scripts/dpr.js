#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SECTION_NAMES = ['tasks', 'summary', 'notes', 'commits'];
const SOURCE_NAMES = ['commits', 'pullRequests', 'claudeSessions', 'workingTree', 'otherRepositories'];
const LIMIT_NAMES = ['summarySentences', 'taskDescriptionSentences', 'maxNotes', 'maxCommits'];
const TEMPLATE_NAMES = ['date', 'repository', 'tasks', 'summary', 'notes', 'commits'];

const STANDARD_SECTIONS = ['tasks', 'summary', 'notes', 'commits'];
const SHORT_SECTIONS = ['tasks', 'summary'];
const STANDARD_LIMITS = {
  summarySentences: 4,
  taskDescriptionSentences: 2,
  maxNotes: null,
  maxCommits: null,
};
const SHORT_LIMITS = {
  summarySentences: 2,
  taskDescriptionSentences: 1,
  maxNotes: 1,
  maxCommits: 3,
};
const DEFAULT_SOURCES = {
  commits: true,
  pullRequests: true,
  claudeSessions: true,
  workingTree: true,
  otherRepositories: true,
};

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

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateKeys(object, allowed, label) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      throw new Error(`Unknown ${label} option: ${key}.`);
    }
  }
}

function validateConfigShape(config, configPath) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`${configPath} must contain a JSON object.`);
  }
  validateKeys(config, ['version', 'sections', 'sources', 'limits', 'template'], 'DPR config');
  if (config.version !== undefined && config.version !== 1) {
    throw new Error(`${configPath} has unsupported version ${config.version}; expected version 1.`);
  }
  if (config.sections !== undefined) {
    if (!Array.isArray(config.sections) || config.sections.some((section) => typeof section !== 'string')) {
      throw new Error(`${configPath}.sections must be an array of section names.`);
    }
    if (new Set(config.sections).size !== config.sections.length) {
      throw new Error(`${configPath}.sections cannot contain duplicates.`);
    }
    for (const section of config.sections) {
      if (!SECTION_NAMES.includes(section)) {
        throw new Error(`${configPath}.sections contains unsupported section: ${section}.`);
      }
    }
  }
  if (config.sources !== undefined) {
    if (!config.sources || typeof config.sources !== 'object' || Array.isArray(config.sources)) {
      throw new Error(`${configPath}.sources must be an object.`);
    }
    validateKeys(config.sources, SOURCE_NAMES, 'source');
    for (const [key, value] of Object.entries(config.sources)) {
      if (typeof value !== 'boolean') {
        throw new Error(`${configPath}.sources.${key} must be true or false.`);
      }
    }
  }
  if (config.limits !== undefined) {
    if (!config.limits || typeof config.limits !== 'object' || Array.isArray(config.limits)) {
      throw new Error(`${configPath}.limits must be an object.`);
    }
    validateKeys(config.limits, LIMIT_NAMES, 'limit');
    for (const [key, value] of Object.entries(config.limits)) {
      const minimum = key === 'maxNotes' || key === 'maxCommits' ? 0 : 1;
      if (value !== null && (!Number.isInteger(value) || value < minimum)) {
        throw new Error(`${configPath}.limits.${key} must be ${minimum === 0 ? 'a non-negative integer or null' : 'a positive integer'}.`);
      }
    }
  }
  if (config.template !== undefined && config.template !== null
    && (typeof config.template !== 'string' || !config.template.trim())) {
    throw new Error(`${configPath}.template must be a relative template filename or null.`);
  }
}

function templatePath(repo, template) {
  if (path.isAbsolute(template)) {
    throw new Error('.dprrc.json.template must be a relative path inside the repository.');
  }
  const resolved = path.resolve(repo, template);
  const relative = path.relative(repo, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('.dprrc.json.template must point to a file inside the repository.');
  }
  return resolved;
}

function readTemplate(repo, configPath, template) {
  if (!template) return null;
  const file = templatePath(repo, template);
  if (!fs.existsSync(file)) {
    throw new Error(`${configPath}.template file does not exist: ${template}.`);
  }
  const content = fs.readFileSync(file, 'utf8');
  const tokens = [...content.matchAll(/{{\s*([A-Za-z]+)\s*}}/g)].map((match) => match[1]);
  for (const token of tokens) {
    if (!TEMPLATE_NAMES.includes(token)) {
      throw new Error(`${configPath}.template contains unsupported placeholder: {{${token}}}.`);
    }
  }
  return { path: template, content };
}

function loadConfig(repo, options = {}) {
  const configPath = path.join(repo, '.dprrc.json');
  let userConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
      throw new Error(`Could not parse ${configPath}: ${error.message}`);
    }
    validateConfigShape(userConfig, configPath);
  }
  const short = Boolean(options.short);
  const baseSections = short ? SHORT_SECTIONS : STANDARD_SECTIONS;
  const baseLimits = short ? SHORT_LIMITS : STANDARD_LIMITS;
  const sections = hasOwn(userConfig, 'sections') ? userConfig.sections : baseSections;
  const sources = { ...DEFAULT_SOURCES, ...(userConfig.sources || {}) };
  const limits = { ...baseLimits, ...(userConfig.limits || {}) };
  const template = readTemplate(repo, configPath, userConfig.template);
  return {
    version: 1,
    mode: short ? 'short' : 'standard',
    sections,
    sources,
    limits,
    template,
    configFile: fs.existsSync(configPath) ? '.dprrc.json' : null,
  };
}

function author(repo) {
  const prefix = repo ? ['-C', repo] : [];
  const email = tryRun('git', [...prefix, 'config', 'user.email']);
  const name = tryRun('git', [...prefix, 'config', 'user.name']);
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

function lastWorkedDate(repo, beforeDate, currentAuthor) {
  if (!currentAuthor.selector) return null;
  const result = tryRun('git', [
    '-C', repo, 'log', '--all',
    `--before=${beforeDate} 00:00:00`,
    `--author=${currentAuthor.selector}`,
    '--format=%ad', '--date=format:%Y-%m-%d', '-n', '1',
  ]);
  if (!result.ok || !result.value) return null;
  const candidate = result.value.split(/\r?\n/).find(Boolean);
  return candidate && /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null;
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
  const reportConfig = loadConfig(repo, options);
  const today = date === localDate();
  const currentAuthor = reportConfig.sources.commits ? author(repo) : { email: '', name: '', selector: '' };
  const commits = reportConfig.sources.commits ? collectCommits(repo, date, currentAuthor) : [];
  const previousCommitDate = reportConfig.sources.commits
    ? lastWorkedDate(repo, date, currentAuthor)
    : null;
  const sessions = reportConfig.sources.claudeSessions
    ? collectSessions(repo, date, options.env || process.env)
    : { directory: null, sessions: [] };
  const github = reportConfig.sources.pullRequests
    ? ghActivity(date)
    : { available: false, pullRequests: [] };
  const working = reportConfig.sources.workingTree ? workingTree(repo, today) : null;
  const other = reportConfig.sources.otherRepositories
    ? otherActivity(repo, date, options.env || process.env)
    : [];
  const hasActivity = commits.length > 0
    || sessions.sessions.length > 0
    || github.pullRequests.length > 0
    || Boolean(working && (working.status.length || working.diffStat));
  return {
    date,
    repo,
    repositoryName: path.basename(repo),
    reportPath: reportPath(repo, date, options.env || process.env),
    reportConfig,
    lastWorkedDate: previousCommitDate,
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
    if (arg === '--date' || arg === '--repo-root') {
      if (!argv[index + 1] || argv[index + 1].startsWith('--')) {
        throw new Error(`${arg} requires a value.`);
      }
      options[arg === '--date' ? 'date' : 'repoRoot'] = argv[++index];
    }
    else if (arg === '--short' || arg === '--shorten') options.short = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h'
    || rest.includes('--help') || rest.includes('-h')) {
    process.stdout.write('Usage: dpr.js collect [--date YYYY-MM-DD] [--repo-root PATH] [--short]\n'
      + '       dpr.js config [--repo-root PATH] [--short]\n');
    return;
  }
  if (command !== 'collect' && command !== 'config') throw new Error(`Unknown command: ${command}`);
  const options = parseArgs(rest);
  if (command === 'config') {
    const repo = repoRoot(options.repoRoot || process.cwd());
    process.stdout.write(`${JSON.stringify({ repo, reportConfig: loadConfig(repo, options) }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(collect(options), null, 2)}\n`);
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
  loadConfig,
  sessionText,
  validateDate,
};
