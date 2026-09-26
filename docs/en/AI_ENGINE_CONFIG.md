# AI Engine configuration

<!-- Language: en -->

The AI Engine helps generate stories and cases, and run assisted tests.
This guide explains what an administrator configures from Treseko and what to
review before using it.

Case generation, assisted classic execution and conversational evaluation are
different workflows. Choose the workflow according to the case format; a
generation workflow is not an executor.

## Before configuring

You need edit permissions in **Settings → AI-Powered Testing** and a compatible
provider available for the instance. In Community, the AI Engine is included
with weekly quotas for executions and case generation.

Provider configuration and assisted authoring are separate surfaces. New
provider credentials are encrypted through the installation vault, never shown
again, and must not be copied into cases, workflows, comments, screenshots or
versioned files.

## Configure a provider and model

1. Open **Settings → AI-Powered Testing**.
2. Choose the provider or compatible endpoint.
3. Indicate the model that will be used.
4. Adjust the timeout, viewport size and temperature when necessary.
5. Save the changes and run a controlled test.

Credentials are stored protected. Do not copy them into cases, workflows,
comments, screenshots or versioned files.

## Choose the right model

- Use a vision model when you need visual auditing or screenshots.
- Keep a low temperature for more repeatable results.
- Use a sufficient timeout for the real flow, especially if there are several
  steps or external pages.
- Start with one AI execution at a time and increase parallelism only after
  validating the provider's capacity.

## Scan models and workflows

The screen lets you query the models exposed by the provider and choose them
without saving an accidental configuration. Workflows are selected by their
use: story generation, test case generation or assisted execution.

Treseko keeps three independent selections: `story_generation` for stories from
requirements, `test_case_generation` for cases from stories and criteria, and
`test_execution` for running tests. Editing or publishing one does not replace
the others. Each execution preserves its purpose, version and frozen snapshot.

Authoring v2 adds scope, out-of-scope items, dependencies and risks to stories,
plus a criterion -> scenario -> case matrix for proposals. Applying proposals
is idempotent, preserves original/edited fingerprints and requires human
review; `scope` and `out_of_scope` are mandatory for v2 application.

A workflow marked as **Experimental** may depend on capabilities that are not
present in all providers. Test it first with non-critical data and review the
result before using it in an operational flow.

The `chatbot-evaluation` workflow applies to `CONVERSACIONAL` cases: it keeps
the frozen configuration, turns, evaluation, traces and available metrics. Its
execution depends on the catalog, provider and instance permissions.

`API` cases can be run manually with the declarative runner or automatically
through the unified worker. The AI mode remains subject to the route and
evidence certified by the instance.

## If the AI Engine does not work

1. Check that the endpoint and credentials are correct.
2. Confirm that the model exists and supports the required capabilities.
3. Verify that quota is available and that the user has permission.
4. Check Monitor and the execution detail to see the error message.
5. Try with a small case before repeating an extensive execution.

Dry-runs help validate readiness without creating an execution, evidence or
project history.

## Universal workflows and versioning

Besides selecting workflows for generation and execution, an installation may
expose the governed universal-workflow editor. Depending on edition and
capabilities it can:

- inspect the runtime manifest, universal agents and capabilities;
- run V2 or V3 preflight (`workflow_format=universal_v3`) before saving;
- create, import, duplicate, edit, validate, archive and restore workflows;
- convert a workflow to blocks or to a universal package;
- export and import workflow packages without credentials;
- publish versions, activate them, inspect history and roll back.

Draft changes require `motor_ia.workflow_drafts:edit`; publishing requires
`motor_ia.workflow_publish:edit`; activation or restore requires
`motor_ia.workflow_activate:edit`; reads use `motor_ia.workflow_view:read`.
Activation while executions are running requires the administrative
confirmation requested by the backend. Do not bypass a failed preflight by
editing the database directly.
