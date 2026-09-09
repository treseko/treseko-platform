# Traceability and assisted generation

<!-- Language: en -->

Treseko relates the functional origin to the execution so the team can answer
which requirement is covered, which case validates it and what evidence exists.

```text
Project → Requirement → Story → Case → Execution → Evidence → Bug/Report
```

## Work with requirements and stories

1. Open **Projects → Requirements and Stories**.
2. Record the requirement, story and acceptance criteria.
3. Link the cases.
4. Review coverage and links.
5. When a story changes, review and confirm the affected links.

Coverage consists of recorded relationships: it does not guarantee that the
case passed or that its evidence is complete. Creating, editing, archiving,
linking and confirming a review are audited when applicable.

## Formats

Traceability does not change the format. Classic keeps steps; API keeps the
contract and assertions; conversational keeps the endpoint, turns and
evaluation. `PERFORMANCE` is reserved and must not be filled with another
structure to force coverage.

## Generate proposals with AI

AI can propose stories from requirements and cases from stories:

1. select the source;
2. estimate the scope and review assumptions;
3. run it if you have permission, quota and a provider;
4. review each proposal;
5. confirm only what you want to save.

Generation does not automatically publish, create scripts or execute arbitrary
code. It preserves the source, assumptions, version, traces and audit.

See [Run history](RUN_HISTORY_GUIDE.md), [Reports](REPORTING_GUIDE.md) and
[AI Engine configuration](AI_ENGINE_CONFIG.md).
