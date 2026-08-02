# Traceability and assisted generation

<!-- Language: en -->

Treseko links the functional origin of a test to its result so the team can
answer which requirement is covered, which case validates it and what the most
recent evidence is.

```text
Project → Requirement → Story → Case → Execution → Evidence
```

## Work with requirements and stories

1. Open **Projects → Requirements and Stories**.
2. Record or update the requirement and its stories.
3. Link the cases that cover each story.
4. Review history when you need to investigate a change.

When a story changes, Treseko can mark its case links for review. Confirm that
the case still covers the expected criterion before considering coverage valid.

## Generate proposals with AI

AI can propose stories from requirements and cases from stories.

1. Select the source requirement or story.
2. Define the scope and review the displayed assumptions.
3. Run the generation.
4. Review each proposal and choose which ones to save.

Generation does not automatically publish stories, create scripts or execute
arbitrary code. Each use keeps its own history, version and audit. Quotas and
permissions are checked before the process starts.

## Quick help

- If you cannot generate proposals, check your permission, available quota and
  configured AI provider.
- If a link requires review, do not ignore it: update or confirm the linked
  case.
- Missing evidence is not the same as approved coverage.

See [AI Engine configuration](AI_ENGINE_CONFIG.md) to prepare the provider and
available workflows.
