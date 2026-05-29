# Product Direction

Truth Layer OS is a workflow harness for AI-assisted Office work that needs to survive being forwarded.

## Problem

AI can create polished decks, spreadsheets, documents, and reports from messy source folders. The file can look done before it is true.

Common failures:

- A deck mixes current numbers with stale numbers.
- A chart cannot be traced to its source data.
- A spreadsheet contains hardcoded projections where formulas are expected.
- A formula points to the wrong cells but returns plausible values.
- An assumption is presented as a fact.
- Speaker notes carry generic reminders instead of evidence.

## Principle

The generated file is not the first artifact. The truth layer is.

The workflow is:

1. Source prep.
2. Structure.
3. File creation.
4. Verification.

The first two stages are mandatory.

## Target Artifacts

- Board decks.
- QBRs.
- Budgets.
- Operating models.
- Investor updates.
- Client presentations.
- Campaign reports.
- Regulatory responses.
- Any workbook where a number can become a decision.

## First Version

The first version creates the control plane:

- Source inventory.
- Conflict log.
- Assumption map.
- Artifact specification.
- Claim and calculation map.
- Hostile-review findings.
- Readiness report.
- Gated export folder.

It does not yet render final Office files.
