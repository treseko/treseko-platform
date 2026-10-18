# Test types and execution modes

<!-- Language: en -->

Treseko separates two decisions that must not be confused:

- the **format** defines the case structure and purpose;
- the **mode** defines how it is executed.

## Formats

| Format | Configuration | Main evidence |
|---|---|---|
| `CLASICA` | Steps with action, data and expected result. | Steps, observations, screenshots and attachments. |
| `API` | Declarative request, variables and assertions. | Request, response, assertions and permitted variables. |
| `CONVERSACIONAL` | UI/API-specific flow; unavailable for MCP. | Available transcript, evaluation, metrics and traces. |
| `PERFORMANCE` | Reserved format. | No load executor is available in this version. |

## MCP

MCP lets assistants discover tools and operate on projects, requirements,
stories, cases, runs and results according to the credential scopes and user
permissions. It can also explore authorized websites and record observed
manual results. Case imports require preview and confirmation. Cases created or
imported through MCP support `CLASICA` and `API`; `CONVERSACIONAL` and
`PERFORMANCE` have no MCP execution path. `PERFORMANCE` remains reserved because
no safe load executor is available.

## Modes

| Mode | How it runs |
|---|---|
| `MANUAL` | A person operates the console and records the verdict. |
| `AUTOMATIZADA` | A compatible runner executes the case and returns results. |
| `AUTOMATIZADA_AI` | The Engine coordinates the available workflow and preserves its evaluation. |

A conversational case is not automatically an AI execution. Likewise, an API case does not need a different worker: when automated, it uses the existing Automation Worker with the `treseko-api/declarative` capability.

## Community 1.0.7 operational matrix (candidate)

| Combination | Public scope |
|---|---|
| Classic + Manual | Step console. |
| Classic + Automated | Automation Worker. |
| Classic + AI | Engine and configured workflow. |
| API + Manual | Backend declarative runner and human evaluation. |
| API + Automated | Unified Automation Worker. |
| API + AI | Do not declare it available without verifying the installation flow. |
| Conversational + Manual | Turn console. |
| Conversational + Automated/AI | Conversational workflow when enabled. |
| Performance | Reserved; do not simulate it with another format. |

## Rules that protect evidence

- Do not mix incompatible formats in the same batch.
- The first conversational message is Turn 1; do not add a historical message as an additional turn.
- The execution preserves a snapshot of the definition, environment, dataset and variables used.
- Sensitive data is redacted by default. Full retention of synthetic data requires an explicit environment policy.
- Bugs are built from the persisted execution, not from data replaced by the browser.
- Names, codes and technical data remain intact even when the interface language changes.

## API testing capabilities

- The declarative runner supports Postman-compatible dynamic variables,
  including `{{$randomUUID}}`, `{{$timestamp}}`, `{{$randomEmail}}` and
  `{{$randomInt}}`. Variables are generated with a per-execution seed and
  unknown placeholders are rejected.
- The public catalog contains 118 official variables and 3 Treseko
  extensions. Postman scripts run inside a sandbox; arbitrary scripts, inline
  credentials, and requests outside the allowlist or configured limits are not
  permitted.
- An environment's `public_test_data=true` policy allows synthetic data to be
  retained for evidence; it is frozen in the execution and never enables
  retention of real secrets.
- Automated API jobs use the unified worker's `treseko-api/declarative`
  capability. Manual/AI execution uses the backend declarative runner and
  preserves redacted snapshots, assertions, scopes and logs.
- Bug deduplication and context are computed from the persisted execution, not
  from replaceable frontend state.

## External API and Automation Worker

`POST /external/executions/report` records results produced by an external runner. It does not start jobs and does not replace the Automation Worker.

For format-specific configuration, see:

- [Test case guide](TEST_CASES_GUIDE.md)
- [Execution guide](TEST_EXECUTION_GUIDE.md)
- [API testing](API_TESTING_GUIDE.md)
- [Conversational testing](CONVERSATIONAL_TESTING_GUIDE.md)
