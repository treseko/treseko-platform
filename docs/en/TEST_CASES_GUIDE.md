# Test case creation and maintenance guide

Use **Add Tests** to organize suites and create cases inside a project. The case format and execution mode are separate dimensions: first choose what is being tested, then how it will run.

<!-- Language: en -->

| Format | Purpose | Main configuration |
|---|---|---|
| `CLASICA` | Step-by-step interface or business flows. | Action, data and expected result for each step. |
| `API` | Declarative HTTP requests and assertions. | Method, URL, headers, body, variables and assertions. |
| `CONVERSACIONAL` | Chatbots and multi-turn services. | Endpoint, session, turns, expectations, memory and evaluation. |
| `PERFORMANCE` | Format reserved for a future load executor. | No reportable executor in this version. |

Available modes are `MANUAL`, `AUTOMATIZADA` and `AUTOMATIZADA_AI`. A conversational case is not automatically an AI test: it can run manually, automatically or through AI according to the selected mode.

## 1. Create a suite

1. Open **Add Tests**.
2. Choose **New Root Suite** or select an existing suite to create a sub-suite.
3. Enter a clear name and save it.

Suites group cases; they do not change their code or historical results.

## 2. Create a case

1. Select the target suite and create a case.
2. Write a title that describes the expected behavior.
3. Complete the objective, preconditions, priority, criticality and tags when applicable.
4. Associate a component, environment and dataset if the case requires them.
5. Complete the configuration for the selected format:
   - `CLASICA`: add steps with **action**, **data** and **expected result**.
   - `API`: complete the declarative configuration: request, variables and assertions; do not use classic steps as a substitute.
   - `CONVERSACIONAL`: configure the endpoint, contract, session, turns, expectations, memory and evaluation; the first configured message is Turn 1.
6. Save the case.

The `TC-...` code is assigned automatically and must not be reused or edited manually.

## 3. Maintain steps and versions

You can reorder, duplicate or remove steps before saving. When changing a case that has already been used, review its version and previous results: historical execution preserves the context in which it was recorded.

## 4. Validate automation

If a `CLASICA` case uses an automation framework, choose the framework and language, add the script and use syntax/context validation before saving. A dry run requires a compatible worker and does not replace a recorded execution. Automated API execution uses the declarative definition and the unified worker; it does not require converting the case into a classic script. The AI mode depends on the format and capabilities enabled in the instance.

For importing existing cases, see [Import compatibility](CASE_IMPORT_COMPATIBILITY.md).

## 5. Configuration rules by format

- Classic steps belong to `CLASICA`; do not use them to represent an `API` or `CONVERSACIONAL` case.
- In `API`, complete `configuracion_api` with the declarative definition. In `CONVERSACIONAL`, complete `configuracion_chatbot` with the endpoint and turns.
- In `CONVERSACIONAL`, the first configured message is Turn 1; do not add a historical opening message as an additional turn.
- `PERFORMANCE` is reserved: do not turn it into API, Chatbot or classic format to simulate a load runner.
- Store expectations and variables in the case configuration or in the corresponding environment/dataset. Do not include credentials in the case.
