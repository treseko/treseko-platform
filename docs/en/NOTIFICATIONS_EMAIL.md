# Notifications and email

<!-- Language: en -->

Email notifications are available with the corresponding Premium
capability. They allow informing important events inside the platform and
by email: assigned bugs, state changes, execution failures or blocks,
AI reviews and quality events.

## Configure email as an administrator

1. Confirm that the license includes **Notifications and email**.
2. Open **Settings → Email**.
2. Complete the SMTP server, port, sender and required credentials.
3. Save the configuration.
4. Send a test email before enabling notifications for the team.

The SMTP password is protected and will not be shown again in the interface. If
you change it at the email provider, also update it in Treseko and repeat the
test.

## Manage rules and templates

In the same section you can enable or disable rules, choose recipients and
adjust the templates. Review each rule before enabling it to avoid
unnecessary notifications.

Personal preferences allow each person to control the alerts they
receive inside the platform when that option is enabled.

## Review deliveries

Deliveries are recorded for audit. From **Settings → Audit** you
can review what was attempted to send, to whom and with what result. If a
delivery fails, fix the SMTP configuration or the destination before
retrying it.

## Quick help

- If an email does not arrive, first send an SMTP test.
- Review the active rules and the destination preferences.
- Verify the SMTP server allows connections from the Treseko host.
- Do not put SMTP passwords in templates, notes or screenshots.