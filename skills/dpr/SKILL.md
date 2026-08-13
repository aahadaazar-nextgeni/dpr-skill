---
name: dpr
description: Generate a client-facing Daily Progress Report for the current Git repository from authored commits, optional GitHub pull requests, Claude Code session transcripts, and today's working-tree changes. Use for requests such as /dpr, daily progress report, or timetravel DPR.
---

# Daily Progress Report

Generate one client-facing report for the current Git repository. Report what was accomplished, the current status, notable decisions, blockers, and relevant commits. Do not expose collection steps, raw diffs, file paths, or internal debugging details.

## Workflow

1. Determine the report date.

   - Normal invocation: use the machine's local date.
   - `timetravel`: look for an explicit date or relative reference in the user's request and resolve it to `YYYY-MM-DD`.
   - If `timetravel` has no date, ask the user which date to use before collecting anything.

2. Resolve the bundled helper path relative to this `SKILL.md`. Run the helper with Node, never by copying its commands into a shell. From the current Git repository, run:

   `node <skill-directory>/scripts/dpr.js collect --date YYYY-MM-DD`

   The helper is cross-platform and handles repository discovery, Git activity, optional GitHub CLI activity, Claude session transcripts, working-tree changes for today, and the report destination. It returns JSON for internal use.

3. Treat Git commits as authoritative for completed work. Use Claude session text only to describe work that is still in progress, decisions, blockers, or open questions. Use pull-request data as delivery context and remove duplication between sources.

4. If the helper reports no qualifying activity, ask whether the user still wants a report. Do not create a file until they confirm.

5. Synthesize related activity into coherent client-facing tasks. Use one of these statuses for each task: `DONE`, `IN PROGRESS`, or `BLOCKED`.

6. Write or replace the report at the helper's reported `reportPath`. Create parent directories if needed. Then show the completed report in chat.

## Report format

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

▸ <Decision, blocker, or follow-up>

▸ Also active that day: <repository-name>
  Generate a DPR from that repository separately if needed.

COMMITS

• <hash> — <summary>

• <hash> — <summary>
```

## Output rules

- Write for a client or stakeholder who wants to understand progress, not implementation mechanics.
- Do not include file paths, raw diffs, shell commands, transcript details, or internal investigation narratives.
- Do not list exploratory work or debugging that is not client-relevant.
- Do not duplicate a commit in both a task and the commit list unnecessarily.
- Replace an existing report for the same repository and date instead of appending.
- If another repository had Claude activity, mention only the repository name returned by the helper; do not inspect that repository's transcripts.
