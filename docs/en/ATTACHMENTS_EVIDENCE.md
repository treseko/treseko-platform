# Attachments and evidence

<!-- Language: en -->

Attachments help define a case and demonstrate what happened during an
execution. Treseko keeps them alongside the corresponding step or result so
they stay available in the history and in the reports.

## Two different uses

| Use | When to attach | Examples |
|---|---|---|
| Step reference | When designing a case. | Screenshot of the action, expected image, supporting document. |
| Execution evidence | When executing or analyzing a result. | Screenshot, photo, PDF or log. |

## Attach a reference to a case

1. Open **Add Tests** and edit the case.
2. Choose the corresponding step.
3. Attach the action reference or the expected result reference.
4. Save the case.

The reference stays available for those who execute the case. Use clear file
names and avoid uploading sensitive information that is not necessary.

## Attach evidence during an execution

1. In the execution console, complete the step result.
2. Select **Attach evidence**.
3. Choose the file and wait for the upload confirmation.
4. Save the step result or finish the execution.

Evidence can accompany a failure, a blocked state or a successful result. If
you are going to report a bug, attach it before creating the report so that the
context is copied correctly.

## Configuration for administrators

Open **Settings → Preferences → Attachments and evidence** to define:

- allowed file types;
- maximum size per file;
- maximum count per step and per evidence;
- pasting from the clipboard;
- whether evidence is mandatory on failures.

Apply limits that fit the available storage and your organization's policies.
Files are stored outside the database and Treseko uses
their fingerprint to avoid physical duplicates.

## Check and troubleshoot

References are seen when editing or executing a case. Execution
evidence can be consulted from the result, Run History, Bug Tracker and the
related reports.

If an upload fails, verify that the file meets the allowed types and sizes,
that your role allows attaching evidence and that there is available storage.
Do not include secrets, passwords or unnecessary personal data in screenshots
and logs.