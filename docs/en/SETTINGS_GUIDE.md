# Settings guide

<!-- Language: en -->

**Settings** brings together administrative and personal options. The tabs and
actions depend on the role, capabilities, instance and available edition.

## Preferences and account

In **My Profile**, maintain your personal data and preferences. If the instance
offers a language setting, it is saved for your account; some backend-generated
messages or exports may depend on the format configuration.

In **Preferences**, review general options and, when enabled, external
automation keys. Store each key in a secrets manager and revoke it when it is
no longer used.

## Users, roles and audit

**User Management** administers accounts; **Roles** assign capabilities and
**Audit** lets you review administrative actions. Available expiration is configured in
**Preferences → Session and security**; the base edition does not include a
general inbox for reviewing or revoking active sessions. Effective access
combines the role, module permission and specific capability. If you need more
access, ask an administrator to confirm your role and capabilities.

## Email, AI, monitor and integrations

- **Email:** SMTP, rules, templates, inbox and delivery.
- **AI testing:** providers, models and workflows.
- **Monitor:** components, workers and technical executions.
- **Integrations:** catalog, state, connection test and configuration.
- **Plugins:** available connections and links.
- **Attachments and evidence:** upload limits and policy.

See [Notifications](NOTIFICATIONS_EMAIL.md), [AI Engine](AI_ENGINE_CONFIG.md)
and [Attachments](ATTACHMENTS_EVIDENCE.md). Visible integrations depend on the
installation and its permissions.

## License and updates

In **License**, review the edition and capabilities recognized by the instance.
The commercial name does not replace checking a capability. In **Updates**,
review the version, backup and controlled environment before updating
production. This guide does not promise commercial capabilities that cannot be
verified in the installation.
