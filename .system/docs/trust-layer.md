# Trust Layer

The trust layer makes polished work inspectable, no matter where the draft artifact was created.

## Required Records

Source records: inventory entries for each input file; see `SourceRecord` in `src/types.ts`.

Claim records: artifact claims and their source, assumption, transformation, and review links; see `ClaimRecord` in `src/types.ts`.

Calculation records: mapped calculations, inputs, expected behavior, risk flags, and review status; see `CalculationRecord` in `src/types.ts`.

Assumption records: named assumptions, values, source links, ownership, status, and notes; see `AssumptionRecord` in `src/types.ts`.

Generation records: source evidence snippets, generated claims, evidence maps, evidence-link suggestions, and generated output receipts; see `SourceEvidenceRecord`, `EvidenceLinkSuggestionRecord`, `GeneratedClaimRecord`, `EvidenceMapRecord`, and `GeneratedOutputRecord` in `src/types.ts`.

## Current Limitation

General-profile v1 runs include a review-decision path for creating/editing/deleting/merging claims, attaching source support with anchors/quotes/rationale, resolving calculation risks, accepting current findings with rationale, and resolving source conflicts. They also write a local export gate receipt: unresolved blockers produce `04_export/general-export-refusal.md`, while ready runs produce `04_export/ready-manifest.json`. General runs seed deterministic unsupported claim candidates from inspected PPTX, Markdown/text, DOCX, and text-based PDF content; write deterministic evidence-link suggestions; and write calculation repair packets. Generation mode adds source evidence snippets, source selection, generated claims, a generated evidence map, local Markdown output when ready, and deterministic formatted and edited Markdown derivatives after readiness. After readiness, MCP can copy approved user-supplied final artifacts locally into `04_export/approved-artifacts/` and write a final artifact receipt. Native Office generation, external model calls, and prose-quality synthesis are still out of scope. Legal-profile runs have a narrower review-decision path and local final export gate, but the gate still refuses unresolved legal blockers or required human review.

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

Generation-mode rules:

- Selected evidence is strict: selected inspection failures, selected undated numeric evidence, unresolved selected-source conflicts, unsupported generated claims, and workbook calculation risks block final Markdown.
- Excluded unused sources stay visible in source evidence, evidence-map, receipt, and final output tables but do not automatically block export.
- Old/final conflicts can be resolved deterministically by selecting the final/current evidence and excluding the old/superseded evidence.
- Two current sources with conflicting values for the same metric block export until resolved.
- No final Markdown is written unless the trust report is `ready`.
- Every final generated claim must include source IDs and evidence IDs.
- Every numeric final generated claim must include a source date.
- `04_export/formatted-output.md` is a deterministic derivative of `04_export/final-output.md`; formatting checks must preserve generated claim IDs, source IDs, evidence IDs, source dates, and excluded-source reasons.
- `04_export/edited-output.md` is also a deterministic derivative of `04_export/final-output.md`; it does not create claims, change source selection, or change readiness.
- Evidence-link suggestions and calculation repair packets are advisory records. They do not verify claims, resolve risks, or bypass review gates.

Chart traceability is enforced only after those records exist. General PowerPoint inspection extracts slide text, notes text, and chart references; DOCX inspection extracts paragraphs, headings, and tables; text-based PDF inspection exposes page paragraphs, section candidates, citation candidates, and table-like rows. The legal profile adds citeable DOCX and text-based PDF passage extraction for supplied legal sources. An artifact is ready only when blocking issues are zero and required review findings are cleared or explicitly accepted through the relevant review path.
