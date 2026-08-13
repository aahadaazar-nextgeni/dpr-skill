# DPR Skill for Claude Code

Generate a client-facing Daily Progress Report from the current Git repository. The skill combines authored commits, optional GitHub pull requests, Claude Code session work, and today's working-tree changes.

Claude Code is supported on macOS, Linux, Windows, and WSL. The helper uses Node.js APIs for path, date, filesystem, and transcript handling so the workflow does not depend on GNU-only shell commands.

## Install from GitHub

Give your team access to the GitHub repository, then run this from the root of the project where the skill should be available:

```sh
npx --yes --package=github:aahadaazar-nextgeni/dpr-skill dpr-skill install
```

The skill is installed only in the current repository at `./.claude/skills/dpr`. Run the command separately in each repository where DPR support is wanted. The installer refuses to run outside a Git repository.

For a private repository, users must have GitHub access and working Git credentials. SSH-based access can be used instead:

```sh
npx --yes --package=git+ssh://git@github.com/aahadaazar-nextgeni/dpr-skill.git dpr-skill install
```

This uses npm only as the package runner; the skill does not need to be published to npm or require an npm subscription.

## Install manually

If you share the skill files directly, copy the entire `skills/dpr` directory—not only `SKILL.md`—into the project where Claude Code should use it:

```text
your-project/
└── .claude/
    └── skills/
        └── dpr/
            ├── SKILL.md
            └── scripts/
                └── dpr.js
```

Then start Claude Code from that project and run `/dpr`.

Use `--dry-run` to preview the destination. Existing installations are preserved unless `--force` is supplied.

## Use

Start Claude Code in a Git repository and use:

```text
/dpr
```

For a previous date:

```text
/dpr timetravel yesterday
/dpr timetravel 2026-08-05
```

If `timetravel` is used without a date, Claude will ask which date to report.

For a shorter report, use the `shorten` modifier with any date mode:

```text
/dpr shorten
/dpr timetravel yesterday shorten
/dpr timetravel 2026-08-05 --short
```

Short mode uses a compact default format with concise task descriptions and summary. Repository configuration can customize its sections and limits.

Reports are saved under Claude's daily-report directory:

```text
~/.claude/daily-reports/<repository-name>/YYYY-MM-DD.md
```

## Requirements

- Claude Code
- Git
- Node.js 18 or newer
- GitHub CLI (`gh`) is optional; authenticated `gh` enables pull-request context

The report still works when GitHub CLI is unavailable or unauthenticated. Claude session transcripts are optional; missing or unreadable transcripts are skipped.

## Design notes

The installed skill contains one instruction file and one Node.js helper. The helper invokes Git and GitHub CLI without a shell, uses platform-aware paths, and reads only the current repository's Claude transcripts. It checks other Claude project directories only by file metadata to note that another repository had activity; it does not read those transcripts.

The report uses the local calendar date of the machine running Claude Code. Time-zone and daylight-saving conversion is intentionally outside this first version's scope.

## Repository configuration

Create `.dprrc.json` in the root of a project to customize the DPR without changing the installed skill. The file is repository-local and can be committed so the team shares the same report format.

Example:

```json
{
  "version": 1,
  "sections": [
    "tasks",
    "summary",
    "notes"
  ],
  "sources": {
    "commits": true,
    "pullRequests": true,
    "claudeSessions": true,
    "workingTree": true,
    "otherRepositories": false
  },
  "limits": {
    "summarySentences": 2,
    "taskDescriptionSentences": 1,
    "maxNotes": 3,
    "maxCommits": 5
  }
}
```

Available sections are `tasks`, `summary`, `notes`, and `commits`. The array controls both which sections appear and their order. For example, use `"sections": ["summary", "tasks"]` to omit notes and commits.

Available sources are `commits`, `pullRequests`, `claudeSessions`, `workingTree`, and `otherRepositories`. Disabled sources are not collected and must not be used when writing the report.

Limits are optional. `summarySentences` and `taskDescriptionSentences` must be positive integers. `maxNotes` and `maxCommits` must be non-negative integers; use `null` for no limit.

Short mode supplies compact defaults only where the repository has not configured a value. Explicit repository sections and limits are respected.

### Custom template

For complete control over the layout, point `template` to a Markdown file inside the repository:

```json
{
  "version": 1,
  "template": ".dpr-template.md"
}
```

Supported placeholders are:

```text
{{date}}
{{repository}}
{{tasks}}
{{summary}}
{{notes}}
{{commits}}
```

The template controls the complete output layout. The DPR skill does not add sections that the template does not request. Template paths must stay inside the repository.

The invocation modifier selects the standard or short built-in defaults. Values in `.dprrc.json` override those defaults. Invalid configuration is reported instead of being silently ignored.

## Development

Run the tests from this repository:

```sh
npm test
```

The package name is intentionally neutral. Distribution is handled through the GitHub repository rather than the npm registry.
