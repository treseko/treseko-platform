# AI scheduling and video evidence

<!-- Language: en -->

## Server execution

The AI launch button submits the entire batch to `POST /ai-missions/`. The run,
snapshots and all AI jobs are saved in one transaction. The browser can close
after receiving confirmation.

**Schedule** uses `POST /ai-schedules/`. It persists project, build, case IDs,
actor and a UTC date in `ai_scheduled_missions`. Dates must be in the future and
include a time zone. This interface schedules one execution, not recurring CRON.

The backend checks due missions every two seconds and creates durable runs/jobs.
New backend processes recover pending schedules after a restart, including dates
missed during downtime, without a browser session. PostgreSQL coordinates
consumers to avoid duplicate batches. The backend and Engine must be available
to execute, or recover availability.

Before starting, it rechecks active actor, permissions, project access,
plan/quota, active build and assigned cases. Invalid selections are blocked;
they are not silently moved to another build or case version. The update pause
also pauses schedule admission.

List schedules with `GET /proyectos/{id}/ai-schedules/`; cancel pending schedules
with `DELETE /ai-schedules/{id}`. The scheduling window reloads these persistent
records after an application refresh.

Apply migration `20261009_0068` before starting the updated backend.

## Video for browser-based AI executions

The Engine records Playwright context pages as 960 × 540 WebM files. Closing the
context finalizes files on success and failure. Popup pages have separate videos
associated with the same execution. Reports store references and offer playback,
not video base64 in the database or report JSON.

`/ai-videos/{id}/` requires authentication, AI Engine permission and project
access. The backend contacts the Engine with its internal token. HTTP ranges are
supported with `Cache-Control: private, no-store`. Files are not exposed through
an open static directory.

API, Chatbot and manual tests do not use this recorder; their existing evidence
contracts remain. External runners and worker frameworks other than Playwright do not gain
automatic video recording from this change.

## Retention and storage

| Engine variable | Default | Purpose |
|---|---:|---|
| `AI_VIDEO_DIR` | `videos` | Private directory; Docker uses `/engine/videos` in the persistent volume. |
| `AI_DRY_RUN_VIDEO_TTL_HOURS` | 24 | Dry-run video expiry after completion. |
| `AI_DRY_RUN_VIDEO_MAX_MB` | 512 | Total quota for completed temporary videos. |
| `AI_VIDEO_REGULAR_MAX_MB` | 10240 | Admission limit for new regular recordings. |
| `AI_VIDEO_DISK_RESERVE_MB` | 512 | Free-space reserve before starting recording. |

Cleanup runs every minute and when recordings start/finish. It deletes expired
temporary recordings and evicts the oldest when their quota is exceeded. Active
recordings are excluded. Incomplete recordings abandoned after a restart are
cleaned after an hour.

Regular videos do not expire under the dry-run policy. At the regular quota or
when free space is insufficient, new recording is omitted while execution
continues. A reference is retained only when completed files total at most
128 MiB. `recording_status=UNAVAILABLE` indicates video could not be retained.
Completed-file quotas are not filesystem quotas: active recording can consume
additional transient space. Use a storage-volume quota for a strict physical
limit.

Expiry or quota eviction can make a temporary video unavailable before its
report is reopened. Report JSON cannot restore it. Automatic deletion preserves
regular evidence and QA records.

## Validation

Checks cover the API with disposable PostgreSQL, recovery by new processes with
the client closed, concurrent consumers, cancellation, permissions, dates,
closed builds, authenticated video proxying and expiry. The real Chromium smoke
generates WebM and verifies that a video player loads it.

[Official Playwright recording documentation](https://playwright.dev/docs/videos).

## Recording choice and dry-run playback

**Record video as evidence** is available before execution, in AI scheduling,
and in dry-run editors. It is enabled initially and can be disabled for each
batch. Scheduled AI missions persist this choice (migration 20261009_0069).

The Automation Worker records Playwright Test and Playwright worker functions,
on success and failure. Regular clips use existing protected attachments (10
MiB per file); dry-run WebM clips use the Engine temporary store, retention and
quota. Other worker frameworks and external runners do not automatically record.

Dry-run results show a player and **Delete video**. Closing preserves the file
until expiry. Deletion requires script-edit and project-edit permissions,
removes files on the server before metadata and permits retry on failure.

## Batches from the execution selector

The classic and conversational test selector submits a single request to
`POST /execution-batches/`. The run, snapshots and every job are committed in
one transaction. If preparing any case fails, neither a partial run nor its
jobs are retained. The environment, dataset and `record_video` choice are
preserved. Conversational AUTOMATIZADA executions keep their fixed evaluation;
IA executions keep their AI strategy.

After acknowledgement, the browser only reads status. The AI scheduler or
dedicated workers process the durable queue independently of that session.
API tests keep their declarative runner; PERFORMANCE is not supported by this
endpoint. A batch accepts up to 500 cases.

## Complete automation data

New jobs preserve original variables, datasets, requests, responses, logs and
evidence. Worker payloads are encrypted at rest and decrypted for authenticated
claims and authorized job views. The frozen `complete_data` policy also preserves
AI reports without replacing business test data.

Results above 768 KiB use resumable chunks with checksum verification. Authorized
users can download the full result; the internal lease credential is excluded.
Pending results remain in `/worker/.state/result-spool` until confirmation.
Updates and container recreation preserve this state.

Worker temporary videos are stored in the backend under
`AUTOMATION_RESULT_UPLOAD_DIR/temporary-videos`, expire after 24 hours and support
authenticated playback and deletion. Files above 10 MiB are preserved completely.
Engine AI recordings retain their existing storage and quota policies.

Insufficient storage fails delivery and retains the result for retry. Evidence is
not truncated to report success. Values already replaced in historical executions
cannot be reconstructed from redacted text.
