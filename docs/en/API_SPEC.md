# External automation API

<!-- Language: en -->

Treseko's documented API is intended exclusively for a runner or CI/CD
pipeline to report the results of automated tests. It requires the Premium
external API capability; it is not used to log in, administer users or operate
the rest of the platform.

## Before integrating the runner

1. Log in to Treseko with the user that will execute the tests.
2. Open **Settings → Preferences → External automation API keys**.
3. Generate a key with a name that identifies the runner or pipeline.
4. Copy it when you create it and store it as a CI secret. The key must not be
   included in code, versioned files or logs.
5. Configure the runner with the Treseko URL and that key.

The key inherits the permissions of the user who created it. That user needs
permission to execute tests and edit access to the project and the build that
the runner will report on. If the key stops being used or is exposed, revoke it
from the same Preferences section and create a new one.

## Available operation

| Method | Route | Use |
|---|---|---|
| `POST` | `/api/external/executions/report` | Records one or more results of automated cases in a build. |

The contract, fields and integration examples are in the
[external automation guide](EXTERNAL_AUTOMATION_API.md).

## Runner authorization

```http
Authorization: Bearer <API_KEY_DE_AUTOMATIZACION_EXTERNA>
```

Also supported is the `X-QA-API-Key` header. The API does not require nor
document an API login: the web session only serves to generate and manage
the API key from the interface.
