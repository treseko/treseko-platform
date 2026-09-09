# Project states

<!-- Language: en -->

The state communicates and preserves the project's operational stage. It does
not by itself guarantee an edit or execution lock, nor does it delete cases,
runs, bugs or evidence; effective actions also depend on the role,
capabilities, build and execution context.

| State | When to use it | Guidance |
|---|---|---|
| Planning | The project is being prepared. | Configure the team, environments and cases. |
| Active | Normal work. | Use the usual flow according to permissions. |
| In QA | A delivery is being validated. | Focus on execution and review. |
| Blocked | There is an impediment. | Investigate before continuing dependencies. |
| Maintenance | Controlled changes. | Limit routine operation. |
| On hold | Work is temporarily stopped. | Preserve it and resume later. |
| Closed | Work is finished. | Consult results; do not treat it as active. |
| Archived | Removed from the regular flow. | Keep it available for historical consultation. |

## Change the state

1. Open **Projects** and choose the project.
2. Enter **Settings and team**.
3. Select the state.
4. Save and communicate the impact.

Before closing, putting on hold or archiving a project, check active
executions, pending jobs and evidence that must be preserved. The project state
does not replace the state of a run, job, case or bug.

## What changes and what does not

- It does not turn a historical build into an active one.
- It does not delete or rewrite snapshots, executions, bugs or evidence.
- Availability or visibility may vary by installation; always check the role,
  capabilities, build, environment and dataset.
- **Blocked** communicates a project impediment; it does not replace a bug.

If an execution does not start, also review the build, environment, dataset and
case state.
