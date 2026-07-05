# Trust Layer

The trust layer makes polished work inspectable, no matter where the draft artifact was created.

## Required Records

Source records: inventory entries for each input file; see `SourceRecord` in `src/types.ts`.

Claim records: artifact claims and their source, assumption, transformation, and review links; see `ClaimRecord` in `src/types.ts`.

Calculation records: mapped calculations, inputs, expected behavior, risk flags, and review status; see `CalculationRecord` in `src/types.ts`.

Assumption records: named assumptions, values, source links, ownership, status, and notes; see `AssumptionRecord` in `src/types.ts`.

## Current Limitation

V1 runs always land blocked or needing review by design because the workflow seeds at least one guaranteed-review record and no tool can resolve findings yet. The ready path activates when the review-loop MCP tools in `ROADMAP.md` can resolve seeded claims and findings.

## Readiness Rules

Current implemented blocking rules:

- A required source is missing.
- A claim has no source.
- A number-bearing inspected source has no valid source date candidate.
- A calculation has unresolved formula risk.
- A source conflict remains open.
- A high-risk assumption lacks an owner or status.
- A source inspection fails.

Current implemented review rules:

- A claim is sourced but the source is stale or background-only.
- An assumption is an estimate.
- A reviewer must choose between conflicting sources.
- A source is unclear, unsupported, or metadata-only.

Chart traceability, slide-level source checks, and document-level claim extraction are enforced only after those records exist. PowerPoint, Word, and PDF are metadata-only in the current version. An artifact is ready only when blocking issues are zero and required review findings are cleared or explicitly accepted outside the harness.
