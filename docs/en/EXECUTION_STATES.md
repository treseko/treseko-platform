# Execution states

<!-- Language: en -->

States show the result of a test, each step and a complete execution. Use them
to decide what to review, repeat or report.

## Case or step states

| State | Meaning | What to do |
|---|---|---|
| Not run | No result has been recorded yet. | Run the test when it is ready. |
| Passed | The observed result matches what was expected. | Save the result and continue. |
| Failed | The behavior does not match what was expected. | Add observations and evidence; report a bug when appropriate. |
| Blocked | The case could not be validated because of a dependency or impediment. | Explain the reason and link or create a bug when applicable. |
| Pending | The step remains open during a manual execution. | Select the result before finishing. |

A case is **Passed** only when all required steps have been validated
successfully. A failure or block remains visible in history and reports.

## Run states

| State | Use |
|---|---|
| Open | The execution is in progress and accepts results. |
| Closed | Results were saved and the run was completed. |
| Canceled | The execution stopped before completion. |

## Record a manual result

1. Open **Execute Tests** and select the case.
2. Review the action, data and expected result for each step.
3. Choose the verdict and add an observation if it helps explain the result.
4. Attach evidence when necessary.
5. Finish and save the result.

## Quick help

- Use **Failed** when the system responded incorrectly.
- Use **Blocked** when an external condition prevents testing, such as a down
  environment or unavailable credential.
- Do not replace a failure with a block to hide it: reports distinguish both
  cases.
- To investigate an earlier result, open **Run History** or the case history.
