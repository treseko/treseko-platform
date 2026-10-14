# Bug Tracker

<!-- Language: en -->

Bug Tracker records defects and preserves the link with the case, execution,
build, component and evidence. The Incident Center is a separate operational
view; see [its guide](INCIDENT_CENTER_GUIDE.md).

## Create a bug from an execution

1. Mark the result as **Failed** or **Blocked**.
2. Save the obtained result, observations and evidence.
3. Select **Prepare internal bug** or **Report internal bug**.
4. Review the title, priority, severity and context.
5. Save and confirm the source link.

The context respects the format: classic preserves steps; API preserves the
request, status, headers, body, assertions and permitted variables;
conversational preserves the endpoint, turns, expected/obtained result,
latency, evaluation and traces. `PERFORMANCE` is reserved and must not be
turned into another bug class.

## Daily management

The list pages through all bugs in groups of 25, 50 or 100, sorted by newest,
oldest or priority. Apply filters with **Filter**, remove individual filter
chips or clear them together. The indicators summarize the entire filtered
result, rather than the current page; **Critical and high** includes both
severity levels. Each indicator opens its matching results. On mobile,
**More filters** expands advanced controls and rows stack their data and actions.

The detail preserves the draft when adding comments or evidence and when
changing status. Saving sends only modified fields. Closing, cancelling edits
or navigating from the detail asks before discarding pending changes; reloading
or closing the tab activates the browser warning. Secondary dialogs hide the
detail while open and preserve its context.

**History** displays status changes with author, date, build and reason.
**Mark as duplicate** requires `bugs.triage` and the `bugs.enterprise` feature:
it suggests matches and lets the user search for the original bug by code or
title. The server rejects self references, cross-project references and chains
of duplicates. Retrying the same relationship does not repeat comments or
status history entries.

Status actions use separate capabilities: resolving requires `bugs.resolver`
and the assigned owner; administrative closures require `bugs.cerrar`; other
transitions use `bugs.triage`. Reopening any closed state requires the build
where the defect reappeared.

The list API accepts `sort=newest|oldest|priority`,
`attention=open|critical|unassigned|retest|no_evidence|linked`, and
`include_summary=true`. Responses retain `items`, `total`, `skip`, and `limit`,
with `summary` added when requested. The standalone summary endpoint keeps its
project/build scope.

## Create and manage a bug manually

From **Bug Tracker → Add new bug**, fill in the title, problem, expected result,
priority, severity and context. According to your permissions, you can assign a
responsible person, comment, attach evidence, change the state, record the fix
build, open API/conversational context and generate an external summary.

Two different defects in the same case remain separate records. Search for an
existing bug before creating another one.

## States, retest and external tools

Use **Ready for retest** and then **In retest** when a fix needs verification.
Record the detection build, fix build and resolution.

Treseko does not create external tickets automatically. You can copy a summary
for Jira, Redmine or GitHub Issues and explicitly save its URL or identifier.

## Quick help

- Attach evidence before reporting when it helps reproduce the problem.
- Prefer readable codes, names and context; do not use UUIDs as the summary.
- If you cannot create or edit a bug, request Bug Tracker or Incident Center
  permissions.
