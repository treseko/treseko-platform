<!-- Language: en -->
# Recover manual execution progress

The classic console saves partial verdicts and observations through **Save progress**. Saving progress does not finish the case or count it as passed, failed or blocked. Before switching cases, returning to the list or changing context, the console saves pending changes. If saving fails, the current case and changes remain available for retry. The browser also warns before closing or reloading with unsaved changes.

Resuming a case restores each step’s persisted status and observations even while the overall result is pending. **Finish and save** continues to record the final result.

History distinguishes an empty result from a loading error. On failure it shows a notice, preserves the last available data and offers a retry.

## Manual conversations

Preparing a run freezes its definition, variables and selected connection. The executable context is stored encrypted; visible evidence follows the selected redaction policy. Editing the environment later does not replace that run’s connection or turns.

All configured turns must be sent before passing a conversation. Early completion as failed or blocked requires a reason. Metrics distinguish HTTP errors from expectation failures and calculate P95 using nearest rank.

Migration `20261010_0073` adds the encrypted private context. Historical executions that retain only redacted credentials cannot reconstruct them: the API instructs the user to start a new execution. Current credentials are never silently substituted.

## Automated API progress

Progress requests are sequential and stop at a terminal state. On connection loss the monitor explains that it shows the last known state and offers a retry; it does not invent a final result.
