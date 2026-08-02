# Import and export suites and cases

<!-- Language: en -->

Treseko allows transferring or backing up suites and cases from the
**Projects → Import / Export** section. The official export uses
`.tcases` packages; the import also supports compatible profiles for other formats.

## Export cases

1. Open the project and go to **Import / Export**.
2. Select **Export**.
3. In the selector choose complete suites, individual cases or a combination.
4. Review the selection and confirm the export.
5. Save the `.tcases` file in a secure location.

When a suite is marked, the cases it contains are included. You can open it to
review the selection before downloading.

## Import cases

1. Open **Import / Export** in the destination project.
2. Select **Import** and choose the file.
3. Choose the origin profile when the format requires it.
4. Use the preview to review suites, cases, warnings and fields that cannot
   be transferred.
5. Confirm the elements you want to incorporate.
6. Review the recent batch to verify the result or revert it within
   the available window.

The preview does not modify the project. Reverting only affects the chosen
import batch and does not undo later manual changes.

## Recommendations

- Export a package before a massive import.
- First try with a small suite when the file comes from another
  tool.
- Review the steps, priorities and links after importing.
- Keep the original files until you validate the batch.

See the [import compatibility](CASE_IMPORT_COMPATIBILITY.md) to
know the status of each profile.