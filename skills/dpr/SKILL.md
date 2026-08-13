---
name: dpr
description: Generate a client-facing Daily Progress Report for the current Git repository from authored commits, optional GitHub pull requests, Claude Code session transcripts, and today's working-tree changes. Use for requests such as /dpr, daily progress report, timetravel DPR, or a shortened/short DPR.
---

# Daily Progress Report

Generate one client-facing report for the current Git repository. Report what was accomplished, the current status, notable decisions, blockers, and relevant commits. Do not expose collection steps, raw diffs, file paths, or internal debugging details.

## Commands and modifiers

Treat `timetravel` as the date modifier and `shorten`, `short`, `--shorten`, or `--short` as the output modifier. Modifiers can appear in any order:

- `/dpr` — standard report for today.
- `/dpr shorten` — short report for today.
- `/dpr timetravel yesterday shorten` — short report for yesterday.
- `/dpr timetravel 2026-08-05 --short` — short report for a specific date.

Keep this modifier model extensible for future output modes. A modifier changes the current invocation only; repository configuration provides defaults.

### Configuration commands

Treat these as setup commands, not report requests. Do not collect activity or create a report when one is used:

- `/dpr create-template` — create a repository-local `.dprrc.json` and `.dpr-template.md`.
- `/dpr configure` — create or update only `.dprrc.json`.
- `/dpr show-config` — display the effective configuration without changing files.

For `create-template` or `configure`:

1. Confirm that the current directory is a Git repository.
2. Check whether `.dprrc.json` or `.dpr-template.md` already exists. If replacing an existing file would be necessary, show what exists and ask for confirmation first.
3. Accept the user's natural-language preferences when provided. Otherwise ask only for the missing choices: sections and order, evidence sources, length limits, and desired headings or layout.
4. Write repository-local files using the supported configuration keys and template placeholders. Never add executable configuration or arbitrary prompt instructions.
5. Validate the result with:

   `node <skill-directory>/scripts/dpr.js config --repo-root <repository-root>`

6. Report which files were created or updated and summarize the resulting behavior. Do not generate a DPR as part of setup.

For `create-template`, create a `.dpr-template.md` containing only these placeholders as needed: `{{date}}`, `{{repository}}`, `{{tasks}}`, `{{summary}}`, `{{notes}}`, and `{{commits}}`. Set `"template": ".dpr-template.md"` in `.dprrc.json`.

For `configure`, preserve an existing `template` setting unless the user explicitly asks to change it. If the user asks to customize only the format, update the template file and leave unrelated source and limit settings unchanged.

For `show-config`, run the helper's `config` command and explain the active mode, sections, sources, limits, and custom template in plain language. Do not expose internal collection details unless the user asks.

## Workflow

1. Determine the report date.

   - Normal invocation: use the machine's local date.
   - `timetravel`: look for an explicit date or relative reference in the user's request and resolve it to `YYYY-MM-DD`.
   - If `timetravel` has no date, ask the user which date to use before collecting anything.

2. Determine whether short mode is active from the invocation modifiers.

3. Resolve the bundled helper path relative to this `SKILL.md`. Run the helper with Node, never by copying its commands into a shell. From the current Git repository, run:

   `node <skill-directory>/scripts/dpr.js collect --date YYYY-MM-DD [--short]`

   Add `--short` only when short mode is active. The helper is cross-platform and handles repository discovery, Git activity, optional GitHub CLI activity, Claude session transcripts, working-tree changes, repository configuration, and the report destination. It returns JSON for internal use.

4. Read `reportConfig` from the helper output. Apply the effective configuration as follows:

   - `sections` controls which report sections appear and their order.
   - `sources` controls which evidence sources were collected. Do not infer facts from a disabled source.
   - `limits` controls maximum summary sentences, task-description sentences, notes, and commits.
   - `template` controls the complete layout when a custom template is configured.

   The invocation modifier selects the built-in mode defaults, and repository `.dprrc.json` values override those defaults. Explicit repository section and limit settings remain respected in short mode; short mode supplies shorter defaults only where the repository has not configured a value.

5. Treat Git commits as authoritative for completed work. Use Claude session text only to describe work that is still in progress, decisions, blockers, or open questions. Use pull-request data as delivery context and remove duplication between sources.

6. If the helper reports no qualifying activity, do not create a report automatically.

   - When the requested date is today, tell the user that no qualifying work was detected today. Offer these choices:
     1. Generate yesterday's report with `/dpr timetravel yesterday`.
     2. Generate the last committed workday with `/dpr timetravel <lastWorkedDate>`, using the helper's `lastWorkedDate` when available.
     3. Choose another date with `/dpr timetravel <date>`.
   - If no `lastWorkedDate` is available, omit that choice.
   - If `lastWorkedDate` is yesterday, combine those two choices instead of presenting duplicate dates.
   - For a `timetravel` date with no activity, tell the user that no qualifying activity was found for that date and ask whether they want to generate an empty report.

   Wait for the user's choice before continuing.

7. Synthesize related activity into coherent client-facing tasks. Use one of these statuses for each task: `DONE`, `IN PROGRESS`, or `BLOCKED`.

8. Render only the configured sections. For a custom template, replace these supported placeholders with the corresponding rendered content: `{{date}}`, `{{repository}}`, `{{tasks}}`, `{{summary}}`, `{{notes}}`, and `{{commits}}`. The custom template is authoritative for layout; do not add unrequested sections around it.

9. Write or replace the report at the helper's reported `reportPath`. Create parent directories if needed. Then show the completed report in chat.

## Default report format

When no custom template is configured, use this format and omit sections not present in `reportConfig.sections`:

```text
TASKS

✓ <TASK NAME> — DONE
  <Client-facing summary.>

✓ <TASK NAME> — IN PROGRESS
  <Current status and next step.>

✓ <TASK NAME> — BLOCKED
  <Reason and impact.>

SUMMARY

<2–4 sentences summarizing the day's overall progress and remaining work.>

NOTES

▸ <Decision, blocker, or follow-up>

▸ Also active that day: <repository-name>
  Generate a DPR from that repository separately if needed.

COMMITS

• <hash> — <summary>
```

In short mode without repository overrides, include `TASKS` and `SUMMARY`, keep task descriptions to one sentence, and keep the summary to two sentences or fewer.

## Output rules

- Write for a client or stakeholder who wants to understand progress, not implementation mechanics.
- Do not include file paths, raw diffs, shell commands, transcript details, or internal investigation narratives.
- Do not list exploratory work or debugging that is not client-relevant.
- Do not duplicate a commit in both a task and the commit list unnecessarily.
- Replace an existing report for the same repository and date instead of appending.
- If another repository had Claude activity and `notes` is enabled, mention only the repository name returned by the helper; do not inspect that repository's transcripts.
