# Run history guide

<!-- Language: en -->

**Run History** keeps executions and frozen data so you can compare results,
review evidence and reconstruct an investigation.

## Find an execution

1. Open **Run History**.
2. Filter by case, date, result, source, build, format or mode.
3. Open **View details**.
4. Confirm the project, build and component.

## What the detail shows

It can include the run, build, component, environment, dataset, source, runner,
format, mode, cases, steps, verdicts, notes, evidence and bugs. It can also
show frozen dynamic variables and configuration, an API result or conversational
transcript/configuration, and an AI report with confidence and human review.

The frozen configuration explains what was executed; it is not the same as the
current case configuration.

## How to investigate

1. Compare it with the previous execution.
2. Identify whether the result is classic, API or conversational.
3. Confirm that the evidence and variables belong to the case and build.
4. Open or prepare the related bug.
5. For AI, review traces, confidence and the human decision.

History is for consultation. To edit, use [Cases](TEST_CASES_GUIDE.md); for
defects, use [Bug Tracker](BUG_TRACKER.md). Prefer readable names, codes and
context over UUIDs, payloads or resolved variables.
