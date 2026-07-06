# Product Direction

Evidence Map is a review and evidence layer for work that needs to survive being forwarded.

## Problem

AI and humans can create polished decks, spreadsheets, documents, and reports that look done before they are true.

Common failures:

- A deck mixes current numbers with stale numbers.
- A chart cannot be traced to its source data.
- A spreadsheet contains hardcoded projections where formulas are expected.
- A formula points to the wrong cells but returns plausible values.
- An assumption is presented as a fact.
- Speaker notes carry generic reminders instead of evidence.

## Principle

The polished file is not the first artifact. The evidence layer is.

The workflow is:

1. Source prep.
2. Structure.
3. Artifact intake.
4. Evidence mapping.
5. Verification.

Source prep, structure, and evidence mapping are mandatory.

## Target Artifacts

Recurring reports and reviews (quarterly business reviews, program status reports), financial and operating models, external-facing presentations (client, board, grant, thesis defense), compliance and regulatory responses, research summaries and coursework deliverables, and any file where a claim or number can become a decision.

## First Version

The first version creates the control layer:

- Source inventory.
- Conflict log.
- Assumption map.
- Artifact specification.
- Claim and calculation map.
- Hostile-review findings.
- Readiness report.
- Gated export folder scoped to the named local artifact.
- Evidence-link suggestions and calculation repair packets.
- Optional local Markdown claim receipt generated from verified claims, plus deterministic formatted and edited Markdown derivatives.

It does not render final Office files or certify original input files for external shipping. Draft artifacts can be created elsewhere and routed through the evidence layer for review. When generation mode is enabled, the general profile emits local Markdown only, with source evidence, generated claims, an evidence map, deterministic formatted and edited derivatives after readiness, and a refusal if any selected claim cannot be verified. The review packet is the primary product; generated Markdown is a traceable receipt, not prose-quality report generation.
