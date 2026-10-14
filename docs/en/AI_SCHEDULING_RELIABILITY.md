# Scheduling AI executions

<!-- Language: en -->

Date-and-time scheduling creates a one-time mission. The UI converts local time
to a UTC instant and immediately sends it to `POST /ai-schedules/`. The database
retains project, build, cases, user, date and state. Closing the browser neither
cancels nor triggers the mission.

The backend loop checks due missions and creates their TestRun and jobs in a
transaction. PostgreSQL and row locks prevent two processes from creating
duplicate executions of the same mission. A mission that became due during an
outage is recovered when the backend returns. Scheduled time determines when
it can enter the queue; actual execution depends on engine availability and capacity.

## Validation and recovery

- A future date with timezone, a nonempty name and at least one case.
- An active user with execution/scheduling permissions and project access.
- An active build with active cases assigned to it. Conversational cases cannot
  be mixed with other formats.
- Permissions, build, cases and quotas are rechecked when launching the mission.
- Permission, plan or selection rejection leaves the mission `BLOCKED`.
- HTTP 408, 429 and 5xx leave it `PENDING` for retry. Temporary errors are displayed
  and cleared after successful enqueueing.
- Unexpected database or infrastructure errors roll back the transaction,
  preserving no partial execution and leaving the mission available to retry.
- Video cleanup, due missions and the queue have independent error handling.
  A cleanup failure does not interrupt scheduling.
- Builds with recorded schedules cannot be deleted, since cascading deletion
  would remove missions. They can be hidden to preserve history.

## Interface

Submission buttons are disabled while a request is pending, and a shared guard
prevents double submission across rerenders. Scheduling failure preserves the
selected cases, name and date for correction or retry.

The list is reloaded from the server. Old responses cannot restore a cancelled
mission or display another project's schedules. Only `PENDING` missions can be
cancelled. If the backend already queued it, cancellation returns a conflict and
does not remove the execution.

Double-click prevention is not persistent request idempotency: if a response is
lost after saving a mission, check the list before creating another. This flow
does not introduce cron recurrence.
