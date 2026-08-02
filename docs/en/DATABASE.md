# Data, persistence and backups

<!-- Language: en -->

Treseko stores operational data in a relational database and attachment
files in persistent storage. This guide helps you understand
what is kept and how to prepare a safe operation.

## What information Treseko keeps

| Area | Main information |
|---|---|
| Organization and projects | Solutions, projects, components, builds, teams, environments and datasets. |
| Test design | Suites, cases, versions, steps, requirements, stories and links. |
| Execution | Runs, results per case, step snapshots, observations and durations. |
| Quality | Bugs, comments, states, external links and metrics. |
| Administration | Users, roles, permissions, preferences, audit and licenses. |
| Evidence | Attachment metadata and the location of the associated files. |

## How the history is kept

When you execute a case, Treseko saves a snapshot of the steps, data and
expected result. That is why the history keeps the context that was used even if the
case is edited later.

Important operational changes, such as modifications to users, roles,
bugs and configuration, remain available for audit according to the user's
permissions.

## Scope of a build

A build defines which cases can be executed and reported. Before starting an
automated or external execution, verify that the case is active and assigned to
the corresponding build.

## Recommended backups

Make a copy before updating Treseko, changing server or running
an important import:

1. Back up the PostgreSQL database.
2. Back up the volume or directory of attachments.
3. Store the configuration files and deployment secrets protected, without
   including them in repositories.
4. Test the restore on an isolated instance before relying on the backup.

The restore must recover the database and the attachments from the same moment so
that evidence stays correctly linked.

## Maintenance

- Use the migrations included with your Treseko version when updating the
  database.
- Do not edit records directly unless you follow a validated technical
  procedure and have a recoverable backup.
- Review the evidence storage and the edition limits before allowing
  massive uploads.

## Quick help

| Situation | What to review |
|---|---|
| A historical result does not match the current case | Check the execution snapshot; the case may have changed later. |
| A case cannot be reported in a build | Confirm the case is active and within that build's scope. |
| An evidence is missing after a restore | Verify that the attachment storage was also restored. |
| An update fails | Restore the tested backup and review the migrations of the installed version. |