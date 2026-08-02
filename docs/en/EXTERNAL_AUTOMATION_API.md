# External API to report automated executions

<!-- Language: en -->

This document defines the Premium contract for external runners, such as
Playwright, Selenium, Cypress, Pytest or CI/CD pipelines, to report results to the
system. Confirm that the license includes the external API before integrating it.

The goal is to cover the flow equivalent to TestLink's `reportTCResult`, but adapted to the real hierarchy of the system:

```text
solution -> project -> component -> build -> case -> steps
```

## What this integration does

- Uses short and stable identifiers for solution, project, component,
  build and case.
- Allows reporting one or more cases assigned to an active build.
- Accepts overall results and, when applicable, per-step results.
- Keeps the external result alongside Treseko's executions history.

## Short codes

Each entity must have a short external code.

Valid examples:

```text
Solution:   SOL-a8f31c22
Project:    PRJ-b91e02aa
Component:  CMP-77ac10ff
Build:      BLD-3f91ad44
Case:       TC-0005
```

Use these criteria when configuring the runner:

- `SOL-xxxxxxxx`, `PRJ-xxxxxxxx`, `CMP-xxxxxxxx`, `BLD-xxxxxxxx`.
- The suffix must be generated randomly or with a compact, non-semantic identifier.
- Do not use names like `BLD-1-5-0-RC`, because the visible name can change.
- Codes must be unique within their natural scope.

Suggested scope:

| Entity | Field | Uniqueness |
|---|---|---|
| Solution / organization | `codigo` | Global |
| Project | `codigo` | Within the solution |
| Component | `codigo` | Within the project |
| Build | `codigo` | Within the component |
| Case | `codigo` | Within the project or component, according to the final system rule |

## External automation API key

The API key is generated and managed from the Treseko interface, not through
API endpoints:

1. Log in with the user that will use the runner.
2. Open **Settings → Preferences → External automation API keys**.
3. Create an identifiable key for the pipeline or runner.
4. Copy it when you create it and store it as a CI secret.

The key inherits that user's permissions. To report executions, the
user must have execution permission and edit access to the project and the
build. Revoke the key from the same section if it stops being used or is exposed.

Recommended format:

```http
Authorization: Bearer treseko_xxxxxxxxxxxxxxxxx
```

Also accepted:

```http
X-QA-API-Key: treseko_xxxxxxxxxxxxxxxxx
```

The API key:

- must belong to an active user,
- must be active,
- inherits the user's permissions,
- validates the execution permission,
- records the last use,
- is stored hashed in the database,
- does not replace nor require an API login.

## Main endpoint

```http
POST /api/external/executions/report
Authorization: Bearer treseko_xxxxxxxxxxxxxxxxx
Content-Type: application/json
```

This endpoint allows reporting one or more cases in a single call.

## Payload

```json
{
  "solution_code": "SOL-a8f31c22",
  "project_code": "PRJ-b91e02aa",
  "component_code": "CMP-77ac10ff",
  "build_code": "BLD-3f91ad44",
  "external_run_id": "pytest-2026-06-20-001",
  "environment": "qa",
  "overwrite": true,
  "cases": [
    {
      "case_code": "TC-0005",
      "status": "FALLO",
      "observations": "El botón de login no estuvo visible.",
      "duration_seconds": 18,
      "evidence_url": "https://ci.example.com/artifacts/login-fail.png",
      "external_case_run_id": "pytest::test_login_invalid",
      "steps": [
        {
          "number": 1,
          "status": "PASO",
          "observations": "Se abrio la pagina de login."
        },
        {
          "number": 2,
          "status": "FALLO",
          "observations": "El botón de login no estuvo visible.",
          "evidence_url": "https://ci.example.com/artifacts/step-2.png"
        }
      ]
    },
    {
      "case_code": "TC-0008",
      "status": "PASO",
      "observations": "Flujo completado correctamente.",
      "duration_seconds": 9
    }
  ]
}
```

## Request fields

| Field | Required | Description |
|---|---:|---|
| `solution_code` | Yes | Short code of the solution/organization. |
| `project_code` | Yes | Short code of the project. |
| `component_code` | Yes | Short code of the component. |
| `build_code` | Yes | Opaque short code of the build. |
| `external_run_id` | Recommended | ID of the external run. Used to deduplicate CI retries. |
| `environment` | No | Environment reported by the external runner. E.g.: `qa`, `uat`, `staging`. |
| `overwrite` | No | If `true`, allows updating the result of the same case within the same `external_run_id`. |
| `cases` | Yes | List of cases to report. |

## Fields per case

| Field | Required | Description |
|---|---|---:|
| `case_code` | Yes | Short code of the case. Example: `TC-0005`. |
| `status` | Yes | Final case result. Values: `PASO`, `FALLO`, `BLOQUEADO`. |
| `observations` | No | General observation of the execution. |
| `duration_seconds` | No | Total duration of the case. |
| `evidence_url` | No | General evidence URL. |
| `external_case_run_id` | No | ID of the test in the external framework. |
| `steps` | No | Optional list of executed steps. |

## Fields per step

| Field | Required | Description |
|---|---|---:|---|
| `number` | Yes | Step number in the case. |
| `status` | Yes | Step result: `PASO`, `FALLO`, `BLOQUEADO`, `SIN_CORRER`. |
| `observations` | No | Step observation. |
| `evidence_url` | No | Specific step evidence. |
| `error_log` | No | Technical error log. |

## Successful response

```json
{
  "run_id": "3d1c0d79-73af-4c8b-a3d9-5e8b7b0f2c10",
  "external_run_id": "pytest-2026-06-20-001",
  "solution_code": "SOL-a8f31c22",
  "project_code": "PRJ-b91e02aa",
  "component_code": "CMP-77ac10ff",
  "build_code": "BLD-3f91ad44",
  "processed": 2,
  "rejected": 0,
  "results": [
    {
      "case_code": "TC-0005",
      "status": "saved",
      "execution_id": "7d20f8bc-6fb4-40f7-8a36-8e8f56755829",
      "final_status": "FALLO"
    },
    {
      "case_code": "TC-0008",
      "status": "saved",
      "execution_id": "aa78e56d-0c71-4c4f-a2fa-f087d89d26b5",
      "final_status": "PASO"
    }
  ]
}
```

## Response with partial errors

The endpoint must be able to process the valid cases and reject the invalid ones.

```json
{
  "run_id": "3d1c0d79-73af-4c8b-a3d9-5e8b7b0f2c10",
  "external_run_id": "pytest-2026-06-20-001",
  "processed": 1,
  "rejected": 1,
  "results": [
    {
      "case_code": "TC-0005",
      "status": "saved",
      "execution_id": "7d20f8bc-6fb4-40f7-8a36-8e8f56755829",
      "final_status": "FALLO"
    },
    {
      "case_code": "TC-9999",
      "status": "rejected",
      "error": "Caso no existe o no esta asignado a la build indicada."
    }
  ]
}
```

## What Treseko validates

Before saving a report, Treseko validates:

1. A valid, active and non-expired API key.
2. An active user.
3. A user with permission to execute tests.
4. That `solution_code` exists.
5. That `project_code` belongs to the solution.
6. That `component_code` belongs to the project.
7. That `build_code` belongs to the component.
8. That the build is active if the policy requires reporting only over active builds.
9. That each `case_code` exists.
10. That each case belongs to the indicated project/component.
11. That each case is assigned to the build.
12. That the sent states are valid.
13. If steps are sent, that the numbers exist, or that an overall result can be recorded if no steps are defined.

## `external_run_id` semantics

`external_run_id` allows deduplicating retries.

Recommendation:

- If it does not exist, create a `TestRun` with source `EXTERNAL_API`.
- If it exists for the same build, reuse it.
- If the same case arrives with `overwrite=true`, update the previous execution of that case within the same run.
- If the same case arrives with `overwrite=false`, reject that case as a duplicate within the same run.

## States

| External state | Internal state |
|---|---|
| `PASO` | `PASO` |
| `FALLO` | `FALLO` |
| `BLOQUEADO` | `BLOQUEADO` |
| `SIN_CORRER` | `SIN_CORRER`, only valid in steps if a partial payload is accepted |

It is not recommended to accept abbreviations like `p`, `f`, `b` in the main contract. If TestLink-style compatibility is desired, an optional normalization mode could be added.

## Python example

```python
import os
import requests

BASE_URL = os.getenv("TRESEKO_API_URL", "http://localhost:9095/api")
API_KEY = os.getenv("TRESEKO_EXTERNAL_API_KEY", "treseko_xxxxxxxxxxxxxxxxx")

payload = {
    "solution_code": "SOL-a8f31c22",
    "project_code": "PRJ-b91e02aa",
    "component_code": "CMP-77ac10ff",
    "build_code": "BLD-3f91ad44",
    "external_run_id": "pytest-2026-06-20-001",
    "environment": "qa",
    "overwrite": True,
    "cases": [
        {
            "case_code": "TC-0005",
            "status": "FALLO",
            "observations": "El botón de login no estuvo visible.",
            "duration_seconds": 18,
            "evidence_url": "https://ci.example.com/artifacts/login-fail.png",
            "steps": [
                {
                    "number": 1,
                    "status": "PASO",
                    "observations": "Se abrio la pagina de login."
                },
                {
                    "number": 2,
                    "status": "FALLO",
                    "observations": "El botón no estuvo visible."
                }
            ]
        }
    ]
}

response = requests.post(
    f"{BASE_URL}/external/executions/report",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json=payload,
    timeout=30,
)

response.raise_for_status()
data = response.json()

print("Resultado reportado")
print("Run:", data.get("run_id"))
print("Procesados:", data.get("processed"))
print("Rechazados:", data.get("rejected"))
```

## Minimal example for a single case

```json
{
  "solution_code": "SOL-a8f31c22",
  "project_code": "PRJ-b91e02aa",
  "component_code": "CMP-77ac10ff",
  "build_code": "BLD-3f91ad44",
  "external_run_id": "playwright-main-20260620-001",
  "cases": [
    {
      "case_code": "TC-0008",
      "status": "PASO",
      "observations": "Execution from Playwright."
    }
  ]
}
```

## Checklist before activating the runner

1. Generate the API key from **Settings → Preferences → External
   automation API keys**.
2. Confirm that the key's user has execution permission and access to
   the project and the build.
3. Test the minimal example with a non-critical test case.
4. Configure a stable `external_run_id` so retries are safe.
5. Store the API key only in the CI secret store.
