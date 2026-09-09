# Attachments and evidence

<!-- Language: en -->

Attachments help define a case and demonstrate what happened. Evidence stays
linked to the step, snapshot or result so it can be consulted from history,
bugs and reports.

## Two different uses

| Use | When to attach | Examples |
|---|---|---|
| Case reference | When designing or versioning. | Expected image or supporting document. |
| Execution evidence | When executing or investigating. | Screenshot, PDF, photo, log or response. |

A reference explains how to test; evidence demonstrates what happened.

## Attach a reference to a case

1. Open **Add Tests** and edit the case.
2. Choose a step or section.
3. Attach the file.
4. Save the version.

## Attach evidence during an execution

1. Complete the result in the corresponding console.
2. Select **Attach evidence**.
3. Choose the file and wait for the upload confirmation.
4. Save the result or finish the execution.

API or conversational tests may include configuration snapshots, responses,
assertions, turns, traces and variables. Those data belong to the format and
are not replaced with classic steps.

## Policy and troubleshooting

If your installation provides it, **Settings → Preferences → Attachments and
evidence** lets you define types, maximum size, count, clipboard support and
whether evidence is mandatory on failures. Uploading requires the relevant
permission.

Evidence can be consulted from the result, Run History, Bug Tracker, Incident
Center and reports. If an upload fails, check type, size, permissions and
storage. Do not include secrets or unnecessary personal data.
