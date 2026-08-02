# AI Engine configuration

<!-- Language: en -->

The AI Engine helps generate stories and cases, and run assisted tests.
This guide explains what an administrator configures from Treseko and what to
review before using it.

## Before configuring

You need edit permissions in **Settings → AI-Powered Testing** and a
compatible provider available for the instance. In Community, the AI Engine
is included with weekly quotas for executions and case generation.

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

A workflow marked as **Experimental** may depend on capabilities that are
not present in all providers. Test it first with non-critical data and review
the result before using it in an operational flow.

## If the AI Engine does not work

1. Check that the endpoint and credentials are correct.
2. Confirm the model exists and supports the required capabilities.
3. Verify there is quota available and that the user has permissions.
4. Check Monitor and the execution detail to see the error message.
5. Try with a small case before repeating an extensive execution.

Dry-runs help validate readiness without creating an execution,
evidence or project history.