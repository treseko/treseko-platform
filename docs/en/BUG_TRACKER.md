# Bug Tracker

<!-- Language: en -->

Bug Tracker lets you record, follow and close defects without losing the link
with the case, the execution, the step and the evidence where they were detected.

## Create a bug from an execution

This is the recommended way when a step fails or is blocked:

1. During the execution, mark the step as **Failed** or **Blocked**.
2. Record the obtained result and attach the available evidence.
3. Select **Prepare internal bug** or **Report internal bug**.
4. Review the title, severity, priority, description and preloaded context.
5. Save the bug.

The bug keeps the origin case, build, component, execution and step. You do
not need to copy that data manually.

## Create and manage a bug manually

Open **Bug Tracker** and select **Add new bug** if the defect does not come
from a recorded execution. Fill in a clear title, the observed problem,
the expected result, the priority and the severity.

From the bug detail you can:

- assign a responsible person;
- add comments and evidence;
- change the state as the fix progresses;
- indicate the build where it was fixed;
- prepare a summary for an external tracker;
- record an external link explicitly.

## States and retest

When closing a bug, Treseko asks for the fix build and a resolution. If
the fix must be verified, use **Ready for retest** and then **In retest**.
This preserves both the build where the problem was detected and the build where
the fix was applied.

## Link external tools

Treseko does not create external tickets automatically. You can generate a summary
to copy and paste into Redmine, Jira, GitHub Issues or another tool and
store the external identifier or link in the bug. Each link is recorded
independently to avoid two bugs sharing a ticket by mistake.

## Quick help

- Report a new bug for a different defect, even if it happens in the same case.
- If the defect already exists, update that bug instead of creating a duplicate.
- Attach evidence before reporting when it helps reproduce the problem.
- If you cannot create or edit a bug, ask an administrator for Bug Tracker
  permissions.