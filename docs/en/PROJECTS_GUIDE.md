# Project guide

<!-- Language: en -->

A project brings together components, builds, environments, datasets, suites,
cases, executions, evidence and traceability.

```text
Solution → Project → Components → Builds → Environments/Datasets → Cases
```

## Before creating a project

Verify that you are inside the correct **Solution**. The solution groups
related projects. If you do not see the create or edit action, an administrator
needs to review your role and permissions.

## 1. Create the project

1. Open **Projects**.
2. Select **New project**.
3. Enter a readable name and a description when appropriate.
4. Select **Create**.
5. Open **Settings and team** to complete the state, owners and visual identity.

Do not create a project for every build: builds represent deliveries within the
same project and let you compare results without losing history.

## 2. Settings and team

In **Settings and team**, you can maintain the name, description, state, logo
or visual identity and members. A global role does not automatically grant all
project capabilities; effective access also depends on the specific permission.
If you need to review the access model, ask an administrator to confirm your
role and capabilities.

## 3. Components and builds

1. In **Components and Builds**, create components such as `Frontend`, `API` or
   `Mobile application`.
2. Create a build with an identifiable name or version.
3. Define the build-case scope.
4. Activate the build when it is ready for validation.

A historical build preserves its context for consultation and comparison. Do
not treat it as active: its cases, configuration, traceability and executions
must not be modified from that context.

## 4. Environments and datasets

An **environment** defines where the test connects, and a **dataset** defines
the prepared data. Avoid real secrets.

- classic uses steps, data and expected results;
- `API` uses a declarative contract and assertions;
- `CONVERSACIONAL` uses an endpoint, profile, variables, turns, expectations,
  memory, tools and evaluation;
- `PERFORMANCE` is reserved: do not assume a load executor or copy the API or
  Chatbot configuration.

See [Test cases](TEST_CASES_GUIDE.md) and [Execution](TEST_EXECUTION_GUIDE.md).

## 5. Requirements and stories

1. Open **Requirements and Stories**.
2. Record requirements, stories and acceptance criteria.
3. Link the cases that cover each story.
4. Review and confirm the links when a story changes.

AI proposes content; it does not automatically publish stories, cases or
scripts. See [Traceability and assisted generation](TRACEABILITY.md).

## 6. Wiki, tickets and incidents

Use **Wiki / Documentation** for agreements and decisions, never for secrets.
Use [Bug Tracker](BUG_TRACKER.md) for defects found during testing and the
[Incident Center](INCIDENT_CENTER_GUIDE.md) for centralized operational
tracking. External integrations depend on the installation and permissions;
they do not create external tickets by default.

## 7. Import and export cases

Before importing, export a backup and review the preview. See [Importer
compatibility](CASE_IMPORT_COMPATIBILITY.md) and the backup instructions
available in your installation.

## Recommended order to start

```text
Solution → Project → Team → Components → Builds → Environments/Datasets
→ Suites and cases → Build scope → Execution → History → Reports
```

## Quick help

| Situation | What to review |
|---|---|
| I cannot create or edit | Role, permission and project state. |
| A build does not appear | That it is active and the case is within its scope. |
| A case does not appear | State, suite, build and filters. |
| A historical build cannot be edited | It is a consultation context. |
| A story changed | Review and confirm its links. |
| I need to move cases | Export `.tcases`, review warnings and import it at the destination. |
