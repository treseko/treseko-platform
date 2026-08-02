# Test case import compatibility

<!-- Language: en -->

Choose the import profile according to the tool that generated the file. The
extension alone does not guarantee compatibility: each profile interprets its
columns, steps and fields specifically.

| Profile | Format | State | Recommendation |
|---|---|---|---|
| `treseko/tcases-v1` | `.tcases` | Stable | Use it for backups and transfers between Treseko projects. |
| `csv/structured-v1` | Treseko CSV | Stable | Use it with the official CSV template. |
| TestLink, TestRail, Xray, Azure Test Plans, Qase, PractiTest, qTest, Zephyr and Gherkin | CSV, XML, JSON, XLSX or `.feature` | Beta | Always review the preview and warnings. |
| `zephyr/csv-v1` | CSV | Under review | Not yet available to import. |

## Choose a profile

1. Open **Projects → Import / Export → Import**.
2. Select the file.
3. Choose the profile that matches its origin.
4. Review the preview before confirming.

The preview indicates ignored fields, differences and possible loss of
information. **Beta** profiles may require manual adjustments after
import. **Under review** profiles are shown to inform their
status, but cannot be used.

Binary attachments travel only in `.tcases`. In other formats Treseko
can preserve references, but not files that are not included in the
origin.