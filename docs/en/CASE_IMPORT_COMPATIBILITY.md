# Test case import compatibility

<!-- Language: en -->

Choose the import profile according to the tool that generated the file. The
extension alone does not guarantee compatibility: each profile interprets its
columns, steps and fields specifically.

| Profile | Format | State | Recommendation |
|---|---|---|---|
| `treseko/tcases-v1` | `.tcases` | Stable | Use it for backups and transfers between Treseko projects. |
| `treseko/legacy-project-v1` | Historical JSON saved as `.treseko` or `.json` | Stable | Imports older project exports, including nested suites, codes, versions and steps. Review diagnostics for fields the old format did not have. |
| `csv/structured-v1` | Treseko CSV | Stable | Use it with the official CSV template. |
| `testlink/xml-v1` | XML | Beta | Always review the preview and warnings. |
| `xray/json-v1`, `qase/json-v1` | JSON | Beta | The extension must match the selected profile. |
| `testrail/xml-v1`, `testrail/csv-v1` | XML or CSV | Beta | Choose the exact profile for the export. |
| `xray/csv-v1`, `azure-test-plans/csv-v1`, `practitest/csv-v1`, `qase/csv-v1` | CSV | Beta | Review columns and preview. |
| `zephyr/json-v1`, `zephyr/xml-v1` | JSON or XML | Beta | Choose the exact profile for the Zephyr product. |
| `qtest/excel-v1` | XLS or XLSX | Beta | Review the preview before confirming. |
| `gherkin/feature-v1` | `.feature` | Beta | Review steps and tags after importing. |
| `postman/collection-v2.1` | JSON | Beta | Imports declarative configuration; external scripts are not run automatically. |
| `zephyr/csv-v1` | CSV | Blocked | Not available for import yet. |

Profile IDs are part of the contract; do not use only the tool name. The stable
profiles are `treseko/tcases-v1` and `csv/structured-v1`; the other enabled
profiles are considered Beta.

## Choose a profile

1. Open **Projects → Import / Export → Import**.
2. Select the file.
3. Choose the profile that matches its origin.
4. Review the preview before confirming.

The preview indicates ignored fields, differences and possible loss of
information. **Beta** profiles may require manual adjustments after import.
**Blocked** profiles are shown to explain their status, but cannot be used.

Binary attachments travel only in `.tcases`. In other formats Treseko may
preserve references, but not files that were not included in the source.
