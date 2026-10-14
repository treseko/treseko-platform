# AI engine evidence and internal scores

<!-- Language: en -->

## Claims and empty states

Claims configured through `expected_false_claim`, `afirmacion_falsa`,
`false_claim` or `claim_falso` require evaluating their complete meaning with
evidence. Scattered matching words do not establish their truth. The claim stays
pending for the auditor, including when a previous validation plan exists.
Existing explicit text, URL, field and JSON assertion contracts remain available.

An empty cart or list expectation requires confirming that the view finished
loading, that no error or loading indicator is present, and citing positive
evidence: a zero counter, an identified container without rows, or an explicit
empty-state message. Missing `Remove` buttons do not create a conclusive
assertion. The auditor receives these requirements and must cite that step's
evidence. Missing evidence blocks the result for review; a model without vision
does not automatically confirm this state.

## Click recovery

Recovering an invalid click obtains a new observation and screenshot. The target
must exist in the previous observation and have a unique visible identity in the
new one, on the same URL without loading signals. Its point is recalculated from
its current bounding box. Before clicking, `elementFromPoint` checks that the
point is still within the target and is not covered. A disappeared or ambiguous
target, or a changed page, rejects recovery and requires replanning the step.

After clicking, the expected outcome is checked. If the contract does not prove
the effect, the step is blocked for review and the click is not repeated during
that attempt. These restrictions apply to converting `click` into `click_at`;
directly requested visual `click_at` actions retain their existing contract.

## Internal scores and calibration

Historical `confidence` fields remain for compatibility. They are internal scores
from 0 to 100, not measured probabilities. The engine records `confidence_source`
(`rules` or `model`) and `confidence_calibration=uncalibrated`. Reports include
`confidence_assessment`, consensus provenance and components per step. A step's
score comes from its terminal action; the final report uses the consensus score.
Rules and model self-assessments are not averaged to construct the final result.
Historical dashboards label their averages as uncalibrated internal scores.

To measure their relationship with checked results:

```bash
cd engine
node --import tsx src/calibrate-internal-scores.ts reviewed-scores.json > calibration.json
```

Input is an array of independently reviewed executions containing `execution_id`,
`source`, `model`, `workflow_version`, `score`, `predicted_status`,
`reviewed_status`, `reviewed_by` and nonempty `evidence_refs`. Accepted statuses
are `PASO`, `FALLO` and `BLOQUEADO`. Review must check the original evidence;
the program validates structure and does not authenticate reviewers.

Incomplete or duplicate samples are rejected. Grouping keeps source, model,
workflow version and score bands separate, returning sample size, observed
agreement with review and a 95% Wilson interval. It does not apply the curve to
runtime or change verdicts. This measures agreement with reviewed verdicts in the
supplied samples, rather than the probability that a test will pass. Representative
calibration requires real correct and incorrect outcomes, reserved evaluation
executions, and renewed review after changing the model or workflow. Until that
evidence exists, the UI retains the uncalibrated label.
