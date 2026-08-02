# Treseko architecture

<!-- Language: en -->

This guide offers a technical view of the self-hosted installation. It is meant
for administrators who need to identify which component to review when there is
a problem, make a backup or integrate an external service.

## Main components

```text
Browser → Frontend → Backend → Database
                        ├→ AI Engine
                        └→ Automation worker
```

| Component | Function | When to review it |
|---|---|---|
| Frontend | Displays the platform in the browser. | The page does not load or a screen does not respond. |
| Backend | Applies permissions, business rules and exposes the API. | An action returns an error or does not save data. |
| Database | Stores projects, cases, executions, users and configuration. | Before restoring or migrating information. |
| AI Engine | Runs the AI-assisted flows. | An AI generation or execution does not start. |
| Worker | Runs automated scripts on a compatible machine. | A job is not picked up or fails in the test environment. |

## How they relate

- The browser communicates with the backend through the web application.
- The backend persists information and validates permissions before each action.
- The AI Engine and workers report results to the backend; they do not write
  directly to the database.
- Attachments are stored as files and are linked to cases,
  executions or bugs through their metadata.

## Data and traceability

Operational information follows this main relationship:

```text
Solution → Project → Component → Build → Case → Execution → Evidence
```

Requirements and stories are linked to cases to measure coverage. Executions
keep a snapshot of the steps and data used, so that a later change to the case
does not alter the historical result.

## Security and operation

- Permissions are validated in the backend, not only in the interface.
- API keys, AI credentials and integrations must be stored as deployment
  secrets or from Treseko's protected configuration.
- Make backups of the database and the attachment storage before updating or
  changing infrastructure.
- Do not expose the backend, the database nor the AI Engine directly to the
  Internet without a proxy and appropriate access controls.

## Where to continue

- [Quick installation](INSTALLATION.md)
- [Docker guide](DOCKER_GUIDE.md)
- [Data, persistence and backups](DATABASE.md)
- [Automation worker](AUTOMATION_WORKER_V1.md)
- [AI Engine configuration](AI_ENGINE_CONFIG.md)
