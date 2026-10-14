<!-- Language: en -->
# Suite organization and states

Suites are shared project folders that organize cases of all four formats.
Format and execution mode belong to the case. Moving a folder within its
component preserves identifiers and relationships; copying creates new folders
and new case identities.

## Destinations and permissions

Creating, editing, moving or copying requires an available folder and active,
unarchived ancestors. Parent and child retain the same component. General
editing does not change a suite's component or migrate its cases to another
component. Operations affecting cases require case editing permission as well
as suite editing permission. The API supports copying only the structure with
`include_cases: false`.

## Archiving and restoring

New archive operations retain the previous individual states of affected
folders and case versions. Restoring that branch recovers those states:
a deprecated case or a previously archived child suite is not accidentally
activated. Repeating the same state does not change the cases again.

Old archive operations did not retain those states. Restoring them recovers the
selected folder and displays a notice to review and restore child suites and
cases individually; the system does not invent previous states.

Archiving blocks cases assigned to active builds or with pending or running
executions/jobs. Deletion remains logical and blocks references to active builds
and executions of affected cases. Normal copying omits archived branches and
archived cases; it does not copy executions.

## Saving and ordering

Suite mutations and their audit record commit together. Creating/copying accepts
an optional `request_id`: repeating a committed request with the same content
returns the existing copy or folder. Different content requires another
identifier. Structural writes coordinate per project in PostgreSQL. The menu
supports moving folders up or down among their siblings.

## Updating

Migration `20261010_0074` adds the internal previous-state record
(`suites.archive_snapshot`). Update backend, frontend and migrations together
using the installation's usual procedure. This record is not exposed as
editable user configuration.
