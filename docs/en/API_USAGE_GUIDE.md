# Usage guide: run automated tests from an external runner

<!-- Language: en -->

This guide covers one flow: sending Treseko automated execution results from Playwright, Selenium, Cypress, Pytest or another CI/CD pipeline. Before integrating it, confirm that your license includes the Premium external API.

## 1. Generate the API key from the platform

Do not generate the credential through the API. Log in to Treseko and navigate to:

**Settings → Preferences → External automation API keys**

Create a key for the runner, copy it only once and store it in your CI secret store. The key represents the user who created it, so that user must be able to execute tests and edit the involved project.

## 2. Prepare the execution

The case must exist, be active and be assigned to an active build. The runner needs the solution, project, component, build and case codes. You can see them in the information for those resources inside Treseko.

## 3. Report the result

The runner sends a `POST` to:

```text
<URL_DE_TRESEKO>/external/executions/report
```

with the key in the header:

```http
Authorization: Bearer <API_KEY_DE_AUTOMATIZACION_EXTERNA>
Content-Type: application/json
```

The payload includes the build context and one or more cases with status `PASO`, `FALLO` or `BLOQUEADO`. For safe retries, send a stable `external_run_id` and use `overwrite` according to whether you want to update or reject an already reported result.

See the [external automation API](EXTERNAL_AUTOMATION_API.md) for the full contract, payloads, responses and a Python example.

## Operational security

- Do not use a Treseko username and password in the runner.
- Do not expose the API key in repositories, screenshots or CI logs.
- Revoke the key from **Settings → Preferences → External automation API keys** if it leaks, the owner changes or it stops being used.

## If you need Treseko to execute the test

This guide covers only reporting from an external runner. To have the platform execute an API test, use **Automated execution** and an Automation Worker that advertises `treseko-api/declarative`. That flow uses the frozen case contract and produces `treseko.api-result/v1`; it does not use this external API or require another worker installation.
