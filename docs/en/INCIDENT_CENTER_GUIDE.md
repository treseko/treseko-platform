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
3. Use the visible search and filters; sort by date or priority and select an
   indicator to view its incidents.
4. Enable **My incidents** to see items assigned to you.
5. Select a row to open its detail.

Filters include state, context type (`CLASICO`, `API` or `CONVERSACIONAL`),
solution, project, component, build, owner, severity, priority and dates.
`PERFORMANCE` is not documented as an operational context supported by this
module. On mobile, **More filters** expands the advanced filters. The summary
covers the entire filtered result, not just the current page. **Critical and high**
includes both severities among open incidents.

## Read the detail

When available, the detail shows code and title, version/build, environment,
dataset, case, component, execution mode, context, affected URL, browser,
operating system, device, screen resolution and reproducibility. The description
and recorded solution appear separately. **View case** and **View execution**
open the related records.

Draft solutions, notes for QA and comments survive tab changes and other actions.
Saving the solution sends only changed fields. Closing or navigating from the
detail asks for confirmation when drafts exist; reloading or closing the browser
tab triggers the browser warning.

An API incident may retain the request, response, status, headers, assertions
and redacted variables. A conversational incident may retain the endpoint,
turns, expected/obtained result, latency, evaluation and traces. UUIDs are
internal; the summary should use readable names and codes.

## States, actions and permissions

Use the module's state help to interpret transitions. Depending on your
permissions, you can edit, assign, change state, comment or attach evidence.
An incident ready for retest requires later verification.

The inbox requires `incidencias.ver`; detail reads also accept Bug Tracker read
access. Actions respect their permissions: resolving requires `bugs.resolver`
and being the assigned owner; closing requires `bugs.cerrar`; other operational
states require `bugs.triage`. Editing, assignment, comments and attachments retain
their independent capabilities. Correction and reopening from any closed state
require an active build in the same project.

**Mark as duplicate** requires `bugs.triage` and the licensed `bugs.enterprise`
feature; it searches for and selects the original bug. The server validates the
link and rejects a generic state transition to duplicate. Export requires
`bugs.exportar`. If the module is missing, ask for your role to be reviewed.

The Center does not automatically create or reopen bugs from unclassified
failures: they remain pending investigation until human review.

## Export and relate

When enabled, export CSV or Markdown and review the content before sharing it
because it may include technical context. Report links to incidents should open
this module or its detail; general defects should open Bug Tracker.

## Solution and environment fields

`resolucion_pantalla` stores screen dimensions; `resolucion` stores the applied
solution. Migration `20261010_0072` separates complete legacy dimension values
without changing ambiguous phrases. For compatibility, creating or editing with
a value such as `1920x1080` in the legacy field stores it as screen resolution.
Transitions retain `resolucion` as the explanation of the solution.

## Quick help

- If an incident is missing, check project, build, filters and permissions.
- If API or conversational context is missing, confirm that it comes from a
  persisted execution of the correct format.
- To create a defect from an execution, start with [Bug Tracker](BUG_TRACKER.md).
