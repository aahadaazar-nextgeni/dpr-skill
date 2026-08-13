# DPR for Claude Code

DPR creates a clear, client-friendly update from the work in your current Git repository. It can summarize completed work, work in progress, decisions, blockers, pull requests, and relevant Claude Code sessions.

It is designed for project repositories, so each project can have its own DPR settings.

## Add DPR to a project

Run this from the root of the project where you want to use DPR:

```sh
npx --yes --package=github:aahadaazar-nextgeni/dpr-skill dpr-skill install
```

Then start Claude Code in that project and run:

```text
/dpr
```

The skill is added only to that project at `.claude/skills/dpr`. There is no npm subscription or npm account required.

### Share or install manually

You can also copy the `skills/dpr` folder from this repository into a project:

```text
your-project/
└── .claude/
    └── skills/
        └── dpr/
            ├── SKILL.md
            └── scripts/
                └── dpr.js
```

Copy the whole folder, not only `SKILL.md`, because the skill uses the bundled helper script.

## Update DPR

If DPR is already installed in a project, run the same GitHub installer with `--force` from that project’s root:

```sh
npx --yes --package=github:aahadaazar-nextgeni/dpr-skill#main dpr-skill install --force
```

The updated skill replaces the old files in `.claude/skills/dpr`. Restart Claude Code afterward so it loads the new version.

Your project’s `.dprrc.json`, `.dpr-template.md`, daily reports, and other project files are not changed.

If DPR was installed manually, copy the latest `skills/dpr` folder over the existing `.claude/skills/dpr` folder, then restart Claude Code.

## Everyday commands

### Create today's report

```text
/dpr
```

Use this at the end of a workday. DPR looks at the current repository and writes the report to Claude's daily-report folder.

### Create a shorter report

```text
/dpr shorten
```

This creates a compact update with concise tasks and summary. It also works with a date:

```text
/dpr timetravel yesterday shorten
/dpr timetravel 2026-08-05 --short
```

### Create a report for another day

```text
/dpr timetravel yesterday
/dpr timetravel last Friday
/dpr timetravel 2026-08-05
```

If a date is not included after `timetravel`, Claude asks which date to use.

### When there was no work today

If `/dpr` finds no qualifying activity today, it does not create an empty report automatically. It tells you that no work was detected and offers:

- yesterday's report;
- the last day with one of your commits;
- another date using `timetravel`.

For example, it may suggest:

```text
/dpr timetravel yesterday
/dpr timetravel 2026-08-12
/dpr timetravel <another-date>
```

## Make DPR match your team

You can create or change the project’s DPR setup directly from Claude. These commands change project files; they do not generate a report.

### Create your own template

```text
/dpr create-template
```

Claude asks what you want, then creates:

```text
.dprrc.json
.dpr-template.md
```

Example conversation:

```text
You: /dpr create-template

Claude: Which sections should the report include?
You: Tasks, summary, and blockers. Leave out commits.

Claude: Should the report be standard or concise?
You: Concise, with the heading "Client update".
```

You can also describe the result in one request:

```text
/dpr create-template with only tasks and summary, no commits, and a concise client update heading
```

If a template already exists, Claude shows what would be changed and asks before replacing it.

### Change the configuration without changing the template

```text
/dpr configure
```

Useful examples:

```text
/dpr configure and omit the commits section
/dpr configure to include only summary and tasks
/dpr configure to show at most three notes and five commits
/dpr configure to stop checking activity in other repositories
```

### See the current setup

```text
/dpr show-config
```

Claude explains which sections, sources, limits, and template are currently active.

### Share a setup with your team

Because configuration is project-local, commit these files with the project if everyone should use the same format:

```text
.dprrc.json
.dpr-template.md
```

## What can be customized?

You can control:

- report sections: tasks, summary, notes, and commits;
- the order of those sections;
- whether commits, pull requests, Claude sessions, working-tree changes, or other-repository activity are considered;
- how many sentences, notes, or commits appear;
- the complete report layout and headings.

Custom templates can use these placeholders:

```text
{{date}}
{{repository}}
{{tasks}}
{{summary}}
{{notes}}
{{commits}}
```

The template stays inside the project repository and is validated before DPR uses it.

## Where reports are saved

Reports are saved by Claude Code under:

```text
~/.claude/daily-reports/<repository-name>/YYYY-MM-DD.md
```

An existing report for the same project and date is replaced, not appended to.

## What you need

- Claude Code
- Git
- Node.js 18 or newer
- GitHub CLI is optional; it adds pull-request context when authenticated

DPR works on macOS, Linux, Windows, and WSL.

## For maintainers

Run the automated tests from this repository:

```sh
npm test
```

The package is distributed from GitHub rather than the npm registry.
