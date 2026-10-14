# Saving and organizing test cases

<!-- Language: en -->

## Saving and retrying

The case and its audit record commit together. If this operation fails, no
partial case changes remain. A subsequent notification failure does not turn
a confirmed save into an error.

Story and reference links are synchronized afterward. If synchronization fails,
the editor keeps its contents and retains the identity of the created test.
Retrying finishes saving that same test. If the definition changes before the
retry, the existing test is updated.

Each step's reference links are replaced in one transaction. Permissions,
attachments and the limit are checked before replacing links. Other evidence
on the step is preserved; a write failure preserves the previous references.
The set of steps may require a retry if synchronization stops between steps.

## Versions and copies

Copying a suite creates one new test per current case. Older versions of the
same case do not become additional tests, and archived or inactive cases are
excluded. The new tests preserve their definition, configuration, steps,
references and traceability, without execution history or automatic build
assignment.

Editing metadata from an older version returns a conflict asking you to reload
the test. Writes to the same test are serialized so version numbers are not
assigned twice.

## Archiving

A test assigned to an active build cannot be archived. This rule applies to
status changes, full saves, and archiving a suite with its sub-suites. Remove
the tests from the active build first. Archiving and restoring keep case
versions in a consistent state.

## Integrations that create cases

`POST /casos/` accepts `request_id`, an optional client-generated UUID for a
creation attempt. Repeating a request with the same identifier and user returns
the existing test. Reusing it with a different definition or project returns
`409`; a different creation requires a new UUID. The identity is persisted in
the database and does not depend on the browser or notification cache. The
editor generates and reuses this identifier when retrying a creation whose
response was lost.
