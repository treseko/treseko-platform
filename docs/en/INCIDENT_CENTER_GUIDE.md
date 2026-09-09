# Incident Center

<!-- Language: en -->

Incident Center is the operational module for viewing and following QA
incidents. It is separate from **Bug Tracker**: they share records, but this
module provides a central inbox with filters, indicators, detail, actions and
exports.

## When to use it

Use **Bug Tracker** to create or review a defect with its technical context.
Use **Incident Center** to view open, critical, blocked or ready-for-retest
items; filter by context, project, build, owner, severity, priority and dates;
open the related case or execution; and follow comments, evidence, state and
resolution.

## Open and filter

1. Select the solution, project and component when applicable.
2. Open **Incident Center**.
3. Use the visible search and filters.
4. Enable **My incidents** to see items assigned to you.
5. Select a row to open its detail.

Filters include state, context type (`CLASICO`, `API` or `CONVERSACIONAL`),
solution, project, component, build, owner, severity, priority and dates.
`PERFORMANCE` is not documented as an operational context supported by this
module.

## Read the detail

When available, the detail shows code and title, version/build, environment,
dataset, case, component, execution mode, context, affected URL, browser,
operating system, device, resolution and reproducibility.

An API incident may retain the request, response, status, headers, assertions
and redacted variables. A conversational incident may retain the endpoint,
turns, expected/obtained result, latency, evaluation and traces. UUIDs are
internal; the summary should use readable names and codes.

## States, actions and permissions

Use the module's state help to interpret transitions. Depending on your
permissions, you can edit, assign, change state, comment or attach evidence.
An incident ready for retest requires later verification.

Viewing requires Incident Center permission or compatible Bug Tracker read
access. Editing also validates edit, assign, triage, comment or attachment
permissions. Export depends on the corresponding capability. If the module is
not visible, ask for your role to be reviewed.

The Center does not automatically create or reopen bugs from unclassified
failures: they remain pending investigation until human review.

## Export and relate

When enabled, export CSV or Markdown and review the content before sharing it
because it may include technical context. Report links to incidents should open
this module or its detail; general defects should open Bug Tracker.

## Quick help

- If an incident is missing, check project, build, filters and permissions.
- If API or conversational context is missing, confirm that it comes from a
  persisted execution of the correct format.
- To create a defect from an execution, start with [Bug Tracker](BUG_TRACKER.md).
