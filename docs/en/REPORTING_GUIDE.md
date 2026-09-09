# Reports and metrics guide

<!-- Language: en -->

Reports and Metrics summarizes executions, bugs, evidence and traceability for
the selected context. It helps decide and communicate results without replacing
the technical history.

## Read the report

1. Select the solution, project, component and build.
2. Open **Reports and Metrics**.
3. Review coverage, health, results and risks.
4. Filter by suite, priority, state, owner, mode, format or evidence.
5. Open the case, bug or run from the table to investigate.

`formato_prueba` distinguishes `CLASICA`, `API`, `CONVERSACIONAL` and the
reserved `PERFORMANCE` format; the execution mode is reported separately. An
empty metric may indicate missing scope or evidence.

## View, refresh and share

Use **Configure view** if you have permission. The Development preset
prioritizes failures, blocked results, bugs and actions; full detail remains
available.

After new executions, refresh before analyzing. When you select **Share**,
Treseko creates a new snapshot when it detects new data. The link points to that
snapshot rather than a mutable historical query; existing snapshots are not
rewritten.

## Report types

- **Executive:** KPIs, risks, trends and main findings.
- **Development:** failures, blocked results, new bugs, pending historical
  bugs, reproduction cards and recommended actions.
- **Internal:** complete technical inventory of the snapshot.

Defect links point to **Bug Tracker** or **Incident Center** according to the
destination. Project, build, environment, dataset, case and BUG/TC codes are
the main reference; UUIDs remain internal relationships.

## Quality Intelligence

When enabled, it summarizes stability, flakiness, technical fingerprints,
assisted diagnoses and an explainable risk snapshot. Diagnoses are reviewable
drafts: they do not confirm root cause, change executions or create bugs
automatically. With new data, rebuild signals before evaluating risk; assisted
decisions require human review and an audited reason.

Consult [Traceability](TRACEABILITY.md), [Run History](RUN_HISTORY_GUIDE.md)
and [Attachments and evidence](ATTACHMENTS_EVIDENCE.md).
