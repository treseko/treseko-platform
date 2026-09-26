# Traceability and governed AI authoring

<!-- Language: en -->

Treseko connects requirements, stories, acceptance criteria and test cases so
coverage can be explained from a need through its latest execution result.

```text
Project -> Requirement -> Story -> Case -> Execution -> Evidence
```

## Traceability workflow

1. Open the project's traceability view and create or select a requirement.
2. Record the story, scope and available acceptance criteria.
3. Request a generation estimate and review assumptions or missing information.
4. Review coverage and links; confirm them again when a story changes.
5. Keep the human decision before applying any generated proposal.

A coverage relationship does not mean that a case passed or that its evidence is
complete. Requirements and stories keep change history, and affected case links
can require explicit review.

## Generate stories with AI

1. Select the requirement and complete its description, scope and criteria.
2. Run the configured **Story generation** workflow.
3. Review, edit and select the proposed stories.
4. Apply only the proposals that should be persisted.

## Generate cases from a story

1. Open a story with structured acceptance criteria.
2. Request a case estimate and review quota and coverage.
3. Run the **Test case generation** workflow.
4. Review title, priority, preconditions, steps, data and expected results.
5. Select the proposals to persist.

Applied cases remain linked to the story and its criteria. Generation never
creates scripts or executes arbitrary code.

## Version 2 authoring contract

Version 2 proposals add explicit scope, out-of-scope items, dependencies and
risks for stories. Case proposals are built from a criterion -> scenario -> case
coverage matrix and include risk rationale. Applying the same confirmation is
idempotent, preserves original and edited fingerprints plus the human decision,
and records criterion coverage and mandatory exclusions.

For v2, missing `scope` or `out_of_scope` is a blocking validation error. The
v1 source remains available as a historical compatibility artifact; the catalog
selects the newer v2 builtin without replacing custom workflows.

## Three independent workflows

Settings selects and audits these independently:

- Story generation.
- Test case generation.
- Test execution.

Each use keeps its active workflow, published version, validation, execution
snapshot and audit trail. A generation workflow is not an executor.

## Governance and safety

- Project permissions, capabilities and quotas are checked by the backend.
- Invalid workflows, unavailable providers and malformed output fail closed.
- Prompts and agents cannot include inline secrets.
- Human review is required before persisting proposals.
- A provider or endpoint that is unavailable must be reported as blocked, never
  as a simulated successful generation.

See [AI Engine configuration](AI_ENGINE_CONFIG.md), [Run history](RUN_HISTORY_GUIDE.md)
and [Reports](REPORTING_GUIDE.md).
