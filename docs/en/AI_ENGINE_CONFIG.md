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

For a local QA investigation, Engine traces can be redirected with
`QA_TEST_TRACE_DIR`. Keep the directory private: traces redact common secrets,
but requests and responses may still contain sensitive user or test data.

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

## Verified provider capabilities

The Test button distinguishes availability from JSON compliance. A nonempty response confirms availability; `structured_json` is confirmed only when the probe returns the requested `{"ok":true}` JSON. This does not certify story, case or action schemas: each workflow retains its validation and review. Vision requires passing two image probes; an inconclusive result retains `vision_status=unknown`. Model names and catalog scans do not replace these checks.

The deployment variable `AI_DISABLE_THINKING` defaults to `false`. When enabled, it requests disabled reasoning through the compatible adapter. Restart the Engine and verify that the provider accepts this option; it does not change the selected model or certify generation quality.

### Story proposal repair

When the model violates the contract, the retry preserves the user instructions, scope and rules of the original request. Repair does not approve a proposal by itself: validation and subsequent review remain required. Automatic assumption acceptance is limited to complete assumptions with explicit LOW risk; MEDIUM, unknown values or incomplete fields are not accepted by this mechanism.

### Authoring output contract

Story and case analysis, generation and review request only their output schema. The client uses an explicit `schema` mode, including repairs and source extraction, to avoid adding a second generic agent template with an empty `decision`. Execution agents retain their shared context contract. This mode is internal and requires no new user configuration option.

An HTTP200 response or a model SUCCESS indicator does not approve a proposal. Structural validation, reference checks and content review remain required. Incomplete responses are rejected; correcting the request contract does not demonstrate that every model can generate valid cases.

Each case proposal must retain the author's `local_id`: non-empty text of up to 80 characters. If it is missing or invalid, the Engine requests a repair and rejects a response that still violates the contract before semantic review. It does not invent identifiers to complete model responses.
