# Notifications and email

<!-- Language: en -->

Notifications can appear in the internal inbox and, when the installation
allows it, be sent by email. They include bug, state, execution, evidence, AI
review and quality events.

## Configure email as an administrator

1. Open **Settings → Email**.
2. Complete the SMTP server, port, sender and credentials.
3. Save.
4. Send a test email.
5. Enable rules after confirming delivery.

The SMTP password is not shown again. If it changes, update it and repeat the
test. Do not put credentials in templates or screenshots.

## Rules, templates and preferences

Depending on your permissions, you can enable rules, manage and preview
templates, control preferences, review the inbox and mark messages as read.
Daily, weekly or monthly digests may also exist. Templates should use readable
links and names, without secrets or unnecessary payloads.

## Delivery and audit

Events and deliveries let you review whether a notification was created,
processed, sent or failed. If it does not arrive:

1. send an SMTP test;
2. review the recipient, rule and preference;
3. check the delivery status;
4. correct the cause and retry only after resolving it.

The inbox and email are different channels: a failed email does not remove the
internal event. External recipients must respect the allowed scope.
