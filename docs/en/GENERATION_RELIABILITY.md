<!-- Language: en -->
# Reviewed story and case generation

Treseko starts from a requirement, analyzes its context and proposes stories
with acceptance criteria. It then proposes manual cases linked to those
criteria. Records are created when the user reviews and confirms them.

## Clarifications and assumptions

- Functional questions are not discarded based on words such as API or security.
- Confirmation requires answers to every current analysis question, without
  unrelated questions, blank answers or repeated answers.
- Answers are retained and sent back to analysis before continuing. When doubts
  remain, the interface stays in the clarification stage.
- In case generation, assumptions are selected individually. Critical assumptions
  require manual acceptance. If a new analysis changes an assumption's text or
  risk, its previous acceptance is not reused.
- Story generation retains its existing low risk defaults; timed continuation
  cannot skip pending questions.

## Current sources

Before generating or applying proposals, Treseko checks that the requirement,
story, criteria and selected sources remain available and match the snapshot
used. New generations record the requirement and story revision; older ones
compare the fields present in their snapshot. A changed source requires a new
analysis. The case wizard offers a restart while preserving instructions and
the selected destination.

Editing a story's criteria text marks its structuring as pending: old structured
rows cannot be used to generate cases as though they reflected the new text.
The story must have current structured criteria again before generating cases.

## Review and persistence

- An applied story must have acceptance criteria and references to known sources
  or accepted assumptions. Each story retains its own evaluation and decision,
  including when several stories are applied together.
- Cases are validated again in the backend. Submitting `PASS` cannot erase a
  `FAIL` in the original proposal. Missing objectives require justified review;
  blank actions and expected results are rejected.
- Referenced criteria must belong to the story. Mandatory criteria require
  coverage or an exclusion with a nonblank reason.
- Case categories must satisfy the contract. The engine requests a repair when
  they do not, rather than guessing from title words.
- Requirement and story creation/editing and proposal application persist data
  and audit records in one transaction. A failed notification after saving does
  not turn a successful save into an error.
- Generation state changes are locked. Repeating application returns the existing
  records without duplicating them, auditing another creation or sending another
  creation notification. The interface also prevents duplicate submissions.

## Scope

Structural validation and traceability do not prove a statement is true or a
case semantically covers a criterion. Human review remains necessary. Model
quality must be measured using representative requirements and expected results.
This flow does not generate scripts or execute tests; resulting cases are
classic manual tests.

To review criteria, open **Edit story**. The editor lets you change their
structure while retaining existing identifiers and marking linked cases for
review when the definition changes. Pending text is shown as a reference.
Saving an edit based on an older revision is rejected to avoid overwriting
another user's changes.

## Content grounding and coverage

The Engine reviews each draft after generation. Quality review looks for
contradictions, invented rules and unobservable results. Traceability review
requires literal source fragments for each criterion; the Engine checks that
those fragments exist in the supplied sources. Selecting a source does not
automatically make it supporting evidence for a rule.

For cases, the review identifies steps that check each criterion and separates
complete, partial and absent coverage. Open **Content grounding and coverage**
to inspect quotes, inferences and related steps. These statuses are AI opinions,
not certifications.

Edited drafts are reviewed again before records are created. New critical
findings are shown first so the user can correct the draft or explicitly accept
and justify the decision. Audit data retains the review and effective provider
and model for each call, including fallbacks. An old Engine response without
this information has no confirmed provider attribution.

## Context and budget

New generations retain the full content of selected Wiki sources. These wizards
no longer silently cut their input to 12,000 characters or force every story to
two–six criteria. The plan follows capabilities, generating one story per call.
The output budget follows model configuration.

A conservative character limit uses the configured context window and output
budget; it does not replace provider token counting. When input does not fit,
the wizard reports the issue: select fewer sources or increase the context
window with a compatible model. It does not claim to have analyzed omitted
context. Large sources are processed in overlapping chunks. Every extracted rule
requires a verifiable literal quote, and every chunk must complete extraction.
The inventory is retained with its source hash and reused while sources match.
If the inventory still does not fit, the limit is reported. The interface shows
source and chunk counts; processing them does not certify semantic completeness.

The analyzer distinguishes missing necessary information from capabilities explicitly outside the scope. Confirmed facts remain facts rather than assumptions. This instruction guides the model; it does not automatically remove questions or prove the analysis correct. Necessary functional questions still require answers.

Automatic continuation only accepts a complete set of LOW risk assumptions with unique identifiers and valid text, without pending questions. A model READY status does not bypass this check. MEDIUM, HIGH, CRITICAL or unknown risks require a manual decision.

A generation workflow without its own profile uses the active profile and preserves its retry and request timeout settings. When the backend request disconnects, the Engine cancels the provider connection and does not retry the cancelled request. Local cancellation does not guarantee every external provider stops computing immediately.

Repair retries for case analysis and authoring preserve additional instructions, scope and the original source and secret handling rules. Repairing the output format does not authorize changing the requested behavior.

Case analysis retains up to 20 scenarios when a count has not been selected yet. The generation limit applies when generating; the plan is not truncated to five scenarios by default.

The total generation wait honors timeout_seconds between 30 and 7200 seconds, matching the UI/API configuration. This budget is separate from the profile request_timeout_seconds, which limits each provider call to at most 900 seconds. Increasing the wait does not guarantee quality or bypass deployment proxy limits.

Case authoring splits scenarios into batches based on the configured output
budget. Before accepting a response, it checks whether the provider reported an
output limit; if so, it splits the batch again and retries it. Truncated
proposals are never retained. If the response for a single scenario also hits
the limit, the flow reports that the output budget must increase or the output
detail must be reduced.

Each generated case retains the scenario assigned to it. Before review, the
engine checks that its criterion references exactly match that scenario. The
reviewer receives the scenario and evaluates that test unit’s objective; it does
not require one case to cover every result under the parent criterion. The
review report separates parent `coverage`, which may be partial for an atomic
case, from `scenario_coverage`, which must confirm that the case verifies its
assigned scenario. Case failures use the latter scope; mandatory aggregate
coverage is checked across the case set before generation is applied. Persisted
criterion links remain in place. Reviewer findings show their scope:
`PARENT_CRITERION` notices are informational and do not block an atomic case;
assigned-scenario and case-quality findings remain actionable.

Wait failures show a readable diagnostic. An exception without a message must not leave the persisted detail or the case flow error response empty.
