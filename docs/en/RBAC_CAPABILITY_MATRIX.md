# Capabilities and permissions

<!-- Language: en -->

This reference helps administrators decide what access to assign. Capabilities
are applied through roles and module permissions; technical identifiers do not
need to be configured manually.

| Area | Common capabilities | Recommendation |
|---|---|---|
| Projects | Portfolio, components, builds, team, environments, datasets, wiki, requirements and stories | QA Lead to edit; Tester to view or collaborate according to the role. |
| Cases | Suites, cases, steps, versions, attachments, scripts and traceability | QA Lead and Tester with editing when designing tests. |
| Execution | Manual, automated and AI execution, evidence and history | QA Lead and Tester according to the authorized method. |
| Automation | Workers, jobs, validation and reusable functions | QA Lead or a specific technical role. |
| Reports | Metrics, export, sharing and traceability | Read access for decision makers; edit only when appropriate. |
| Bugs | Create, edit, assign, comment, attach, triage and external links | Tester to report; QA Lead to triage and assign. |
| Configuration | Preferences, profile, users, roles, license, AI and API keys | Restricted administration; each user manages their own API keys. |
| Notifications | Personal inbox, rules, templates, SMTP and audit | Users for the inbox; administrators for configuration. |

## Apply the least privilege necessary

- Grant **Reader** if the person only needs to view information.
- Grant **Editor** only if they must create, change or administer resources.
- Separate execution roles from global configuration roles.
- Review permissions after team or responsibility changes.

If an action is not visible despite access to the module, review the edition,
license, project status and specific permissions with an administrator.
