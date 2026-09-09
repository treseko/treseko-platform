# Conversational testing guide

<!-- Language: en -->

A conversational test validates a chatbot or multi-turn service. Its format is `CONVERSACIONAL`, but its mode may be manual, automated or AI-assisted.

## Before you start

You need an environment with the permitted endpoint, a dataset when the scenario uses variables and, for AI evaluation, an enabled profile and workflow.

## Configure the connection

1. Define the HTTP endpoint and request/response contract.
2. Select the method, headers and response mapping.
3. Configure the session path only if the service returns a real reusable identifier.
4. Choose the environment, dataset and profile.
5. Use **Test connection** for an ephemeral check. This action does not create an execution or modify the turns.

Credentials must come from the environment or a protected profile, never from a public example or text pasted into the documentation.

## Define the conversation

1. Add the turns in order. The first configured message is Turn 1.
2. Define the response you expect and the elements it must include.
3. Configure memory and tools only when they can be verified.
4. Choose whether the session is reused or restarted for each turn.

An expectation does not prove that a tool was used. Treseko can state that only when the response or an available trace provides evidence.

## Run and evaluate

- **Manual:** the console sends each turn and a person records the result.
- **Automated/AI:** the `chatbot-evaluation` workflow preserves the snapshot, transcript, metrics and evaluation when the installation has it active.

Execution freezes the connection, turns, dataset, variables, profile and evaluation rules. The conversational bug is built from that execution and may include expected/obtained values, latency, HTTP data, assertions and traces with the corresponding redaction.

## Avoid these confusions

- Do not use classic steps as a substitute for turns.
- Do not use the external results API to start a conversation.
- Do not convert `PERFORMANCE` into conversational format to simulate load.
- Do not add a historical `opening_message` as an extra turn.

## Checklist

- [ ] Endpoint, method and contract are complete.
- [ ] Environment, dataset and profile match the scenario.
- [ ] At least one turn with a verifiable expectation exists.
- [ ] The connection test did not alter the definition.
- [ ] The selected mode has the required permissions and workflow available.
- [ ] You reviewed the snapshot, transcript, evaluation and evidence.
- [ ] The bug is associated with a persisted and eligible execution.

Also see [Test types and execution modes](TEST_TYPES_AND_EXECUTION.md), [Execution guide](TEST_EXECUTION_GUIDE.md) and [Incident Center](INCIDENT_CENTER_GUIDE.md).
