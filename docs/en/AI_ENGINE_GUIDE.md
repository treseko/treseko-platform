# AI Engine operation guide

<!-- Language: en -->

The **AI Engine** centralizes AI-assisted tasks and their tracking. Availability
depends on the instance configuration, permissions and enabled capabilities.

## What it can do and what not to assume

The engine can participate in story/case generation, assisted execution and
conversational evaluation. Each task has its own workflow, snapshot and
output. The availability of a model alone does not certify a complete API,
conversational or classic execution.

## Before using it

1. Confirm that the required provider, model or workflow is configured in
   **Settings → AI-Powered Testing**.
2. Select the project and build you want to work on.
3. Verify that the data sent does not include secrets or information that
   should not be processed by the chosen provider.

## Responsible use

AI can assist in generation, analysis or execution, but it does not replace QA
review. Before saving a suggestion or using a result in a quality decision:

- verify the case, the data and the expected result;
- confirm the evidence and the reported steps;
- review errors, limits or task status in the monitor;
- document the human decision when the flow requires it.

## If a task fails

Check the displayed message, the provider configuration and the instance
limits. If the task corresponds to an execution, also see [Run history](RUN_HISTORY_GUIDE.md).
Do not mass-repeat an operation until you understand the cause.

For technical configuration, see [AI Engine configuration](AI_ENGINE_CONFIG.md).

AI results require human review before creating a bug or approving a build. In
Chatbot, first complete the connection, turns and expectations; the evaluation
must not invent evidence that the endpoint did not return.
