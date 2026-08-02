# Test execution guide

<!-- Language: en -->

This section lets you select cases from the active build and run them manually,
automatically or with the available AI Engine.

## 1. Prepare the context

1. Choose the project, component and build in the top bar.
2. Open **Execute Tests**.
3. Filter by suite, state, priority, owner or bugs when you need to reduce the
   list.
4. Mark the cases to run and choose **Start execution**.

## 2. Choose the mode

- **Manual:** record the result of each step in the execution console.
- **Automated:** sends the case to a compatible worker. It requires a valid
  script and an available worker.
- **AI Agent Engine:** uses the AI capability enabled in the instance. Review
  its result before using it as a quality decision.

You can choose an environment and dataset when the case needs them. Check the
URL, credentials and data before starting.

## 3. Run manually

1. Select the case in the batch.
2. Read the action, data and expected result for the step.
3. Choose the verdict and record an observation when it adds context.
4. Attach evidence when applicable.
5. Repeat for the remaining steps and use **Finish and save result**.

A failure can block subsequent steps according to the case rule. If you detect
a defect, you can report it without leaving the execution context.

## After execution

The result is available in the case, **Run History**, reports and bug
traceability. See [Run history](RUN_HISTORY_GUIDE.md) to review a completed run.
