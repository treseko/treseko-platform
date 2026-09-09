# Dashboard guide

<!-- Language: en -->

The Dashboard summarizes the health of the project and the selected build. It
helps you decide what to investigate first; it does not replace an execution
detail, a bug or a shared report.

## Before starting

Select the solution, project, component and build in the top bar. The active
build defines the main scope for results, bugs and metrics. If there is no build
or execution, some blocks may show `No data`.

## How to read the view

1. Open **Dashboard** and confirm the visible context.
2. Review **Quality summary** and **Tests in build**.
3. Continue with **Recent failures**, **Open bugs** and the **Build window** to
   prioritize work.
4. Use **Refresh** after an execution or when you need new data.

The view can include quality health, tests for the day, recent executions,
build window and trend, open bugs, failed cases, average duration and the
distribution by execution mode. The mode distribution does not change the case
format: an `API` or `CONVERSACIONAL` case can run with another modality. See
[Test cases](TEST_CASES_GUIDE.md) and [Execution states](EXECUTION_STATES.md).

## Custom views

When you have permission, use **Edit dashboard** to choose, order and save the
blocks. Customization affects your view and does not delete data. If you can
only view the dashboard, you will see the layout without editing controls.

The Dashboard uses a short-lived cache. Refresh queries the summary again, but
does not create a shared report or a historical snapshot.

## What to review first

- **Failed**, **Blocked** or **Not run** cases;
- open bugs without an assignee or evidence, or with high priority;
- differences between builds;
- incomplete coverage between requirements, stories and cases;
- executions with incomplete evidence.

An empty value can mean that there is no scope, execution or permission; it
does not prove by itself that everything is correct. To investigate, open [Run
history](RUN_HISTORY_GUIDE.md), [Reports and metrics](REPORTING_GUIDE.md) or
[Bug Tracker](BUG_TRACKER.md).
