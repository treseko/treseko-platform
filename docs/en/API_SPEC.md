# External automation reporting API

<!-- Language: en -->

This guide documents only the external API used by a runner or CI/CD pipeline to report automated test results. It requires the Premium external API capability; it is not used to log in, administer users or operate the rest of the platform. Internal declarative API execution uses the Automation Worker and is documented in [API testing](API_TESTING_GUIDE.md).

## Before integrating the runner

1. Log in to Treseko with the user that will execute the tests.
2. Open **Settings → Preferences → External automation API keys**.
3. Generate a key with a name that identifies the runner or pipeline.
4. Copy it when you create it and store it as a CI secret. The key must not be included in code, versioned files or logs.
5. Configure the runner with the Treseko URL and that key.

The key inherits the permissions of the user who created it. That user needs permission to execute tests and edit access to the project and build that the runner will report on. If the key stops being used or is exposed, revoke it from the same Preferences section and create a new one.

## Available operation

| Method | Route | Use |
|---|---|---|
| `POST` | `/external/executions/report` | Records one or more automated case results in a build. |

The contract, fields and integration examples are in the [external automation guide](EXTERNAL_AUTOMATION_API.md).

## Runner authorization

```http
Authorization: Bearer <API_KEY_DE_AUTOMATIZACION_EXTERNA>
```

The `X-QA-API-Key` header is also supported. The API does not require or document an API login: the web session is used only to generate and manage the API key from the interface.

## External API and API worker are different

- **External API:** a runner outside Treseko executes tests and reports the result through `POST /external/executions/report`.
- **Unified API worker:** the official worker claims `API_EXECUTION` jobs, executes the declarative contract and returns results with the `treseko.api-result/v1` schema. There is no second worker dedicated exclusively to API tests.

The external route does not start an execution or deliver credentials to the runner; the worker receives a frozen job prepared by Treseko.
