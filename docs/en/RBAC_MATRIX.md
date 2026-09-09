# Permission matrix by role

<!-- Language: en -->

This is a reference. Actual authorization also depends on capability, level,
organization/project scope and entitlement.

| Action | ADMIN | QA LEAD | TESTER | VIEWER |
|---|---:|---:|---:|---:|
| View permitted projects, cases, runs and reports | Yes | Yes | Yes | Yes |
| Create/edit suites and cases | Yes | Yes | According to capability | No |
| Administer projects, builds and environments | Yes | Yes | No | No |
| Run manual tests | Yes | Yes | According to capability | No |
| Run automation/API with an approved worker | Yes | Yes | According to capability and scope | No |
| Run AI/conversational evaluation | Yes | Yes | According to capability and entitlement | No |
| Attach evidence and report bugs | Yes | Yes | According to capability | No |
| Triage and assign bugs/incidents | Yes | Yes | According to capability | No |
| Share reports and create snapshots | Yes | According to entitlement | According to permission | No |
| Configure integrations/plugins | Yes | According to permission and entitlement | No by default | No |
| Administer users, roles and license | Yes | According to permission | No | No |

## How to apply it

1. Define the task.
2. Choose a base role.
3. Adjust capability, level and scope.
4. Confirm the edition.
5. Test with a test account.

Yes does not authorize access outside the organization or project, nor does it
enable Premium in Community. See [Access, users and permissions](AUTH_RBAC_GUIDE.md).
