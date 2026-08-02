# Project guide

<!-- Language: en -->

A project gathers the QA work of a product or initiative: its
components, builds, environments, cases, executions, evidence and traceability.
This guide proposes an order to configure it and leave it ready to work.

## Before creating a project

Verify that you are working within the correct **Solution**. The solution
groups the projects of an organization or client. If you need to create or
manage solutions, ask for access to **Settings → Clients / Solutions**.

You also need edit permissions in **Projects**. If the option to
create or edit does not appear, an administrator must review your role.

## 1. Create the project

1. Open **Projects**.
2. Type the name in **New project**.
3. Select **Create**.
4. Open the newly created project.
5. Enter **Configuration and team** to complete its description, state and
   owners.

Use a name that identifies the product or initiative. Avoid creating a project
for each build: builds are managed within the project.

## 2. Configuration and team

In **Configuration and team** you can update the name, description,
state and the people who participate in the project.

- Use **Active** while the team works normally.
- Use **In QA** when the focus is on validating a delivery.
- Use **Blocked**, **On hold** or **Maintenance** to communicate a
  particular operational condition.
- Use **Completed** or **Archived** when finished, without losing the history.

Define owners who can maintain components, builds and execution
scope. See [Project states](PROJECT_STATUS_RESTRICTIONS.md) to
choose the right state.

## 3. Components and builds

Open **Components and Builds** to separate the product parts and the
deliveries you will validate.

1. Create the components, for example `Frontend`, `API` or `Mobile app`.
2. Within each component, create a build with a readable version or name.
3. Define the build's scope: the cases that can be executed and reported.
4. Activate the build when it is ready for validation.

A build is the context of a delivery. Assign only the cases that correspond to
that version; in this way the results, bugs and reports keep a clear scope.

## 4. Environments and datasets

In **Environments and Datasets** record where the tests will run and with
what data.

- An environment identifies the destination, for example `QA`, `Staging` or
  controlled Production.
- A dataset describes the information prepared for an execution, for example
  test accounts, catalog or initial conditions.

Select the environment and dataset when running a test. Do not load real
passwords or secrets into the project's visible data.

## 5. Requirements and stories

Open **Requirements and Stories** to maintain the relationship between the
functional goal and the test cases.

1. Record the requirement.
2. Add the stories and acceptance criteria.
3. Link the cases that verify each story.
4. Review the links when a story changes.

You can use AI to propose stories or cases, but review and select
the proposals before saving them. See [Traceability and assisted generation]
(TRACEABILITY.md) for the full flow.

## 6. Wiki, tickets and incidents

- In **Wiki / Documentation**, create Markdown pages for agreements, project
  guides, decisions and useful links. Each page keeps a history.
- In **Tickets and Incidents**, record or link project incidents
  when you have the integration and permissions enabled.

Do not use the Wiki to store API keys, passwords or secrets. For defects
detected during an execution, prefer [Bug Tracker](BUG_TRACKER.md), which
keeps the full QA context.

## 7. Import and export cases

Open **Import / Export** to incorporate suites and cases, download a
`.tcases` backup or revert a recent run within the available window.

Before a massive import, export a backup and review the preview.
See [Import and export suites and cases](CASE_PORTABILITY.md) for the
steps and compatible formats.

## Recommended order to start

```text
Solution → Project → Team → Components → Builds → Environments/Datasets
→ Suites and cases → Build scope → Execution → Reports
```

You do not need to complete all subsections the first day. Start with a
project, a component, an active build and a small set of cases; then
expand environments, traceability, documentation and integrations according to the team.

## Quick help

| Situation | What to review |
|---|---|
| I cannot create a project or build | Your role and the state of the solution/project. |
| A case does not appear when executing | That it is active and within the scope of the selected build. |
| I do not see a subsection | The permissions of Projects, traceability, Wiki or integrations. |
| A story changed | Review the links with cases before trusting their coverage. |
| I need to move cases to another project | Export them as `.tcases` and import them from the destination project. |