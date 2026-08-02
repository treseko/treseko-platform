# Access, users and permissions

<!-- Language: en -->

Review date: 2026-07-26.

This guide explains how to enter Treseko and how to manage who can view or
modify each work area. Access configuration is done from the
platform; no API is needed.

## What you can manage

From **Settings** you can:

- create, edit and inactivate users;
- assign a base role or a custom role;
- define which modules each role can view or edit;
- review the relevant changes in the audit;
- manage the external automation API keys from **Preferences**.

To make these changes you need edit permissions in Settings. If you
do not see a section, ask an administrator to review your role.

## Log in to Treseko

Treseko supports local login with email and password. When the
organization configured Active Directory, LDAP or OIDC, it can also show the
corporate access option.

1. Open the login screen.
2. Choose the method available for your organization.
3. Enter your credentials.
4. When done, use **Sign out** from the user menu.

The session expires according to the policy defined by the administrator. If it
expires or your password changes, log in again.

### If you cannot sign in

- Confirm that the email and password are correct.
- If you use corporate access, check with your identity team that your account
  is still active.
- Ask an administrator to confirm that your user is not inactive.
- After several failed attempts, wait a few minutes before trying again:
  Treseko limits attempts to protect accounts.

## Manage users

Open **Settings → User Management** to view active users and
create or edit accounts.

### Create a user

1. Select **New user**.
2. Fill in the requested data and choose the available access type.
3. Assign a base role or a custom role.
4. Save the changes.

The person will be able to use their role's permissions when logging in. To limit
access precisely, first create a custom role and then assign it to the
user.

### Edit or inactivate a user

From the user's row you can update their data, change the role or
inactivate them. Inactivating preserves traceability: it does not delete executions, cases,
audit or other historical records.

You cannot inactivate your own account. Ask another administrator to do it if
necessary.

## Work with roles

Open **Settings → Roles** to review and manage
custom roles.

### Base roles

Treseko includes these reference roles:

| Role | Habitual use |
|---|---|
| `ADMIN` | Global platform administration. |
| `QA_LEAD` | Management of projects, executions, reports and integrations. |
| `TESTER` | Creation and execution of tests. |
| `VIEWER` | Read-only consultation. |

Use them as a starting point. When a team needs a different scope,
create a custom role.

### Create a custom role

1. Select **New role**.
2. Provide a name and a description that explain who it is intended for.
3. Choose the access level for each module.
4. Save the role.
5. Assign it from **User Management** to the corresponding people.

A custom role allows maintaining the same access rule for several
people. If you change its permissions, review which users have it assigned before
saving.

## Choose permissions per module

Each module can have one of these levels:

| Level | What it allows |
|---|---|
| No access | The user cannot access the module. |
| Reader | Can view the information, without modifying it. |
| Editor | Can view and perform the enabled editing actions. |

The **Editor** level includes read access. Apply the least privilege
needed: for example, a lead who only reviews metrics should have **Reader** on
Reports and Metrics, not edit access to Projects.

The modules that can be assigned include Dashboard, Run Tests, Add
Tests, Projects, Inventory, Reports and Metrics, AI Engine, integrations,
Run History and Settings. The platform also validates permissions when performing
sensitive actions, not only when showing the menu.

## Audit and security

Changes to users, roles and permissions are recorded so an
administrator can review them. Use the **Settings → Audit** section
when you need to know what changed, who did it and when.

To keep the account secure:

- do not share passwords or API keys;
- use a different API key per automation runner or pipeline;
- revoke an API key from **Settings → Preferences → External
  automation keys** if it stops being used or is exposed;
- inactivate users who no longer have access to the platform;
- review roles after a change of responsibilities.

## Corporate access

Active Directory, LDAP and OIDC are corporate authentication options that an
administrator enables and configures for the organization. These options validate
the person's identity; the permissions inside Treseko are still defined by
the roles and permissions configured in Treseko.

If your organization uses these methods and the sign-in option does not appear, ask the
administrator to review their configuration and the corresponding license.

## Quick help

| Situation | What to do |
|---|---|
| I do not see a module | Ask to review your role and its permissions. |
| I can view but not edit | Request **Editor** level for that module if your function requires it. |
| A user left the team | Inactivate them; do not delete historical traceability. |
| A runner cannot report executions | Check the API key, the user's execution permission and the project and build access. |
| I need special permissions | Create a custom role and clearly describe its purpose. |

For the detailed capability matrix by role, see the
[RBAC matrix](RBAC_CAPABILITY_MATRIX.md).