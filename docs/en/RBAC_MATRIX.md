# Permission matrix by role

<!-- Language: en -->

Use this matrix as a reference when creating or reviewing roles. Actual
permissions can be adjusted with custom roles under **Settings → Roles**.

| Action | ADMIN | QA LEAD | TESTER | VIEWER |
|---|---:|---:|---:|---:|
| View projects, cases, history and reports | Yes | Yes | Yes | Yes |
| Create and edit suites and cases | Yes | Yes | Yes | No |
| Administer projects, components, builds and environments | Yes | Yes | No | No |
| Run manual tests | Yes | Yes | Yes | No |
| Attach evidence and report bugs | Yes | Yes | Yes | No |
| Run authorized automation and AI | Yes | Yes | According to custom role | No |
| Configure project integrations | Yes | Yes | According to permission | No |
| Administer users, roles and global preferences | Yes | According to permission | No | No |

## How to use this matrix

1. Identify the person's or team's actual tasks.
2. Choose the closest base role.
3. Create a custom role if modules need to be limited or expanded.
4. Test the role with a test account before assigning it broadly.

The **No access**, **Reader** and **Editor** levels determine what a role can
view or modify in each module. See [Access, users and permissions](AUTH_RBAC_GUIDE.md)
for the creation and assignment steps.
