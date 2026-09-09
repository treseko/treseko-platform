# Import and export suites and cases

<!-- Language: en -->

Portability is managed from Projects → Import / Export and requires the
provider capability. Native export uses `treseko.test-cases-package/v1` and the
`.tcases` extension.

## Native package

It includes a manifest plus suites.json, cases.json, versions.json and
attachments.json. The manifest preserves SHA-256 checksums, which are verified
before records are created; attachments are also validated. Cases preserve
stable codes, versions, datasets, automation metadata, API/Chatbot
configuration and supported traceability links.

## Historical `.treseko` packages

Older Treseko project exports were JSON and were commonly saved with the
`.treseko` extension. Import them with `treseko/legacy-project-v1`. Nested
suites, codes, versions and steps are reconstructed; fields absent from the
historical format are completed with compatible defaults and reported in the
preview diagnostics. Do not confuse this case package with `license.treseko`,
which is a license file and does not contain test cases.

## Profiles

| Profile | Extension | State |
|---|---|---|
| treseko/tcases-v1 | .tcases | Stable |
| treseko/legacy-project-v1 | .treseko, .json | Stable; historical compatibility |
| csv/structured-v1 | .csv | Stable |
| testlink/xml-v1 | .xml | Beta |
| xray/json-v1, xray/csv-v1 | .json, .csv | Beta |
| zephyr/json-v1, zephyr/xml-v1 | .json, .xml | Beta |
| zephyr/csv-v1 | .csv | Blocked; no validated fixture |
| azure-test-plans/csv-v1 | .csv | Beta |
| qtest/excel-v1 | .xls, .xlsx | Beta |
| practitest/csv-v1 | .csv | Beta |
| testrail/xml-v1, testrail/csv-v1 | .xml, .csv | Beta |
| qase/json-v1, qase/csv-v1 | .json, .csv | Beta |
| gherkin/feature-v1 | .feature | Beta |
| postman/collection-v2.1 | .json | Beta |

Beta does not mean universal compatibility. Review the preview and diagnostics.
The maximum upload is 20 MB. A wrong extension, invalid checksum or blocked
profile stops the import.

## Import

1. Open Import / Export in the destination project.
2. Choose the profile and file.
3. Review duplicates, new versions, warnings and non-transferable fields.
4. Select the elements and confirm.
5. Review the batch.

The preview does not modify anything. Import saves external references and
hashes to detect duplicates and new versions. It does not execute arbitrary
scripts.

## Revert

A completed batch can be reverted for one hour if the cases have no executions
or later changes. It does not undo manual changes and may be rejected if the
batch has already been used or modified.

## Recommendations

- Back up the database and attachments before a mass import.
- Test with a small file.
- Review steps, `CLASICA`/`API`/`CONVERSACIONAL` format, priorities and links.
- Check the profile state in the application.
