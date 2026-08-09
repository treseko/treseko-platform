# Reports and metrics guide

<!-- Language: en -->

This section turns executions, bugs, evidence and active-build traceability
into a quality tracking view.

## Read the report

1. Select the project, component and build.
2. Open **Reports and Metrics**.
3. First review traceability coverage, build health and the result summary.
4. Apply filters to limit the analysis by suite, priority, state, owner, mode
   or evidence.

Filters affect the visible detail tables and metrics. If data is not shown,
verify the selected context before concluding that it is missing.

## Configure the view

Use **Configure view** to reorder, show or hide blocks. Cards can adapt to the
available space; after resizing them, check that tables and metrics remain
readable.

## Quality Intelligence

When the project has this block enabled, it summarizes signals calculated from
already recorded executions:

- health and stability for each case, including a *flaky* signal when
  comparable results alternate;
- failures grouped by a technical fingerprint, so the same issue can be
  investigated without opening duplicate diagnoses;
- assisted diagnoses that separate facts, hypotheses, evidence and unknowns;
  they are drafts, can be edited by creating a new auditable version, and
  require human review before a bug is created; and
- an explainable release-risk snapshot, which neither changes the build state
  nor approves the build automatically.

You can recalculate the signals after new executions. If there are new
executions or evidence, the analysis becomes stale: rebuild it before creating
diagnoses, evaluating risk, or accepting risk. Risk flakiness uses only the
selected build observations and, when available, compares the last accepted
build as context. Accepting risk requires a reason and is audited. If
executions, coverage or evidence are missing, the correct outcome can be
**Human review**. Impact-based regression selection does not replace the
complete suite until a traceable change source exists.

## Common actions

- Refresh data after an execution.
- Open a case, bug or execution from a table to investigate.
- Use traceability coverage to find requirements or stories without linked
  cases.
- Export or share reports only when the capability is enabled.

The [Traceability](TRACEABILITY.md) guide explains how to fix incomplete links
between requirements, stories and cases.
