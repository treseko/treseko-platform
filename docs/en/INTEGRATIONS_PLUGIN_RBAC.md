# Integrations and plugins

<!-- Language: en -->

An integration connects Treseko with an external system. A plugin adds
a capability within Treseko. The **Plugins** section shows what is
included, available or upcoming for your edition.

## Use integrations

Integrations allow relating QA work with tools such as
Redmine, Jira, GitHub Issues, GitLab, Azure DevOps or a CI/CD pipeline when
the capability is enabled for your installation.

1. Open **Settings → Plugins** or the corresponding integration
   section.
2. Review whether the integration appears as included, available or Premium.
3. Configure only the credentials and data authorized by your organization.
4. Test the connection before using it in a project.

Treseko does not show already stored secrets. If you update a token, save it in
the integration configuration and avoid copying it into cases, comments or
evidence.

## Link bugs with external tools

From a bug's detail you can prepare a summary to copy and paste into an
external tool and store the identifier or link of the created ticket. The
linking is explicit: Treseko does not publish external issues automatically.

Each link belongs to a specific bug. If two defects need distinct
tickets, record a link for each one.

## Plugins

Included plugins extend capabilities such as case portability, internal Bug
Tracker, AI Engine and assisted generation. The store can also show
future or Premium capabilities; those cards report their availability, they
do not install third-party code in the background.

## Permissions

The configuration of integrations, secrets and plugins is restricted to
authorized roles. If you can see an integration but not configure it, ask the
account administrator to review your permissions in Settings.

## Quick help

- Verify the connection before using an integration with real data.
- Use a technical account with the least possible scope in the external tool.
- Revoke and replace a token if it is exposed.
- Check the license status if an integration or plugin appears
  as Premium.