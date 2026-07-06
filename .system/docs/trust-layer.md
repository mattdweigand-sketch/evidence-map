# Trust Layer

The trust layer makes polished work inspectable, no matter where the draft artifact was created.

## Required Records

Source records: inventory entries for each input file; see `SourceRecord` in `src/types.ts`.

Claim records: artifact claims and their source, assumption, transformation, and review links; see `ClaimRecord` in `src/types.ts`.

Calculation records: mapped calculations, inputs, expected behavior, risk flags, and review status; see `CalculationRecord` in `src/types.ts`.

Assumption records: named assumptions, values, source links, ownership, status, and notes; see `AssumptionRecord` in `src/types.ts`.

## Current Limitation

General-profile v1 runs include a review-decision path for creating/editing/deleting/merging claims, attaching source support with anchors/quotes/rationale, resolving calculation risks, accepting current findings with rationale, and resolving source conflicts. They also write a local export gate receipt: unresolved blockers produce `04_export/general-export-refusal.md`, while ready runs produce `04_export/ready-manifest.json`. After readiness, MCP can copy approved user-supplied final artifacts locally into `04_export/approved-artifacts/` and write a final artifact receipt. Broad automatic claim extraction, richer calculation repair artifacts, and final artifact generation/editing are still roadmap work. Legal-profile runs have a narrower review-decision path and local final export gate, but the gate still refuses unresolved legal blockers or required human review.

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

Chart traceability, slide-level source checks, and document-level claim extraction are enforced only after those records exist. General PowerPoint inspection now extracts slide text, notes text, and chart references; general DOCX inspection extracts paragraphs, headings, and tables. The legal profile adds citeable DOCX and text-based PDF passage extraction for supplied legal sources. An artifact is ready only when blocking issues are zero and required review findings are cleared or explicitly accepted through the relevant review path.
