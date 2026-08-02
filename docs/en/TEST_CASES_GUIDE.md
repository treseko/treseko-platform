# Test case creation and maintenance guide

<!-- Language: en -->

Use **Add Tests** to organize suites and create cases that will run inside a
project.

## 1. Create a suite

1. Open **Add Tests**.
2. Choose **New Root Suite** or select an existing suite to create a sub-suite.
3. Enter a clear name and save it.

Suites group cases; they do not change their code or historical results.

## 2. Create a case

1. Select the target suite and create a case.
2. Write a title that describes the expected behavior.
3. Complete the objective, preconditions, priority, criticality and tags when
   applicable.
4. Associate a component, environment and dataset if the case requires them.
5. Add steps with **action**, **data** and **expected result**.
6. Save the case.

The `TC-...` code is assigned automatically and must not be reused or edited
manually.

## 3. Maintain steps and versions

You can reorder, duplicate or remove steps before saving. When changing a case
that has already been used, review its version and previous results: historical
execution preserves the context in which it was recorded.

## 4. Validate automation

If the case uses an automation framework, choose the framework and language,
add the script and use syntax/context validation before saving. A dry-run
requires a compatible worker and does not replace a recorded execution.

For existing cases, see [Import compatibility](CASE_IMPORT_COMPATIBILITY.md).
