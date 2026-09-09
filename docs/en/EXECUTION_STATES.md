# Execution states

<!-- Language: en -->

Treseko uses different states for a case or step, the complete `run` and the
worker jobs. Do not mix them when interpreting history or a report.

## Format and modality

`formato_prueba` describes the structure: `CLASICA`, `API`, `CONVERSACIONAL` or
`PERFORMANCE`. `tipo_prueba` describes the modality: `MANUAL`, `AUTOMATIZADA` or
`AUTOMATIZADA_AI`. In addition, each execution records an operating mode:
`MANUAL`, `IA`, `AUTOMATIZADA` or `EXTERNA`.

A conversational case is not automatically an AI test. `PERFORMANCE` is
reserved and has no documented load executor.

## Case or step states

| State | Meaning | What to do |
|---|---|---|
| Not run | No result has been recorded yet. | Run it when the context is ready. |
| Passed | It matches what was expected. | Keep the evidence and continue. |
| Failed | It does not match what was expected. | Record the observed result, notes and evidence. |
| Blocked | A dependency prevented validation. | Explain the block and track it. |
| AI running | An AI evaluation is in progress. | Wait for completion or review its state. |

For API tests, status, headers, body and assertions are evaluated. For
conversational tests, turns, responses, expectations and evaluation are kept.

## Run states

| State | Use |
|---|---|
| Open | It was created and accepts results. |
| In progress | Cases or steps are being executed. |
| Closed | It was finalized and persisted. |

## Automated job states

Worker jobs can be `PENDING`, `CLAIMED`, `RUNNING`, `PASSED`, `FAILED`,
`BLOCKED`, `ERROR`, `TIMEOUT`, `CANCELLED` or `BLOCKED_BY_RUNNER`. They are
technical queue states and do not replace the functional result. The unified
worker also runs declarative API tests; there is no separate API worker.

## AI review and manual result

An AI execution may require human review. Review confidence, consensus, report
and review state before deciding. A diagnosis does not confirm root cause or
create a bug automatically.

To record a result manually:

1. Open **Run Tests** and select the case.
2. Confirm the build, environment and dataset.
3. Use the console for the case format.
4. Choose the result, note and evidence.
5. Finish and verify it in [Run history](RUN_HISTORY_GUIDE.md).

Use **Blocked** for a real dependency, not to hide a failure. See [Attachments
and evidence](ATTACHMENTS_EVIDENCE.md).
