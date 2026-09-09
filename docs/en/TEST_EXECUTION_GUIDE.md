# Test execution guide

<!-- Language: en -->

This section lets you select cases from the active build and run them manually, automatically or with AI. The executor is selected from the persisted `formato_prueba` and the chosen mode; conversational cases must not be mixed with other formats in the same batch.

## 1. Prepare the context

1. Choose the project, component and build in the top bar.
2. Open **Execute Tests**.
3. Filter by suite, state, priority, owner or bugs when you need to reduce the list.
4. Mark the cases to run and choose **Start execution**.

## 2. Choose the mode

- **Manual:** use the console corresponding to the format; the step console applies to `CLASICA`, the declarative console to `API` and the multi-turn console to `CONVERSACIONAL`.
- **Automated:** sends the case to the compatible executor. `CLASICA` may require a script; `API` uses the unified worker's declarative definition and `CONVERSACIONAL` uses its chatbot workflow.
- **AI Agent Engine:** uses the AI capability enabled in the instance. Review its result before using it as a quality decision.

| Format | Manual | Automated | Automated with AI |
|---|---|---|---|
| `CLASICA` | Step console. | Compatible Automation Worker. | AI/assisted Engine, subject to configuration and permissions. |
| `API` | Declarative runner from Treseko. | Unified Automation Worker with `treseko-api/declarative`. | The general contract contemplates AI, but do not promise an uncertified end-to-end path in the instance. |
| `CONVERSACIONAL` | Multi-turn console and human evaluation. | Chatbot workflow with snapshot and persisted evidence. | `chatbot-evaluation`, if the instance has the workflow, provider and required permissions. |
| `PERFORMANCE` | Not available as a reportable executor. | Not available. | Not available. |

The external reporting API is different from the worker: it receives results from an external runner at `POST /external/executions/report`; it does not start jobs or replace the Automation Worker.

You can choose an environment and dataset when the case needs them. Verify the URL, credentials and data before starting.

## 3. Configure a conversational test

A conversational test does not connect to an isolated port: it needs a complete HTTP URL and a contract that tells Treseko how to send the message and read the response.

1. In **Add Tests**, choose the **Conversational** format.
2. Select one of the initial contracts:
   - **Generic HTTP JSON** for your own API.
   - **OpenAI-compatible** for `chat/completions` endpoints.
   - **HTTP with text response** when the request is JSON but the response is plain text.
3. Enter the URL or inherit it from the environment. For services installed on another host or in a container, use an address reachable from Treseko; `localhost` always represents the process running Treseko.
4. Configure the method, headers and request template. Keys and private URLs must live in the environment, not in each case.
5. Define the response format and, for JSON, the message path. The session path is optional and is used only when the API returns an identifier that must be preserved between turns.
6. Use **Test connection**. This check sends only the sample message, displays HTTP status, latency, format and extracted text, and does not add a turn or create an execution.
7. Add the turns and their expectations. **Reuse session** preserves context; **New session per turn** tests independent conversations.

Responses can be evaluated by expected text, expressions, security rules, memory and final outcome. If you declare an internal tool, the call is considered verified only when the endpoint exposes observable evidence; otherwise Treseko evaluates only the final response.

## 4. Run manually

1. Select the case in the batch.
2. For `CLASICA`, read the action, data and expected result for each step.
3. For `API`, review the request, assertions and runner response.
4. For `CONVERSACIONAL`, review each turn, its response and its checks.
5. Choose the verdict, record an observation when it adds context and use **Finish and save result**.

A failure can block subsequent steps according to the case rule. If you detect a defect, you can report it without leaving the execution context.

## After execution

The result is available in the case, **Run History**, reports and bug traceability. See [Run history](RUN_HISTORY_GUIDE.md) to review a completed run.
