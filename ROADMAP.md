# Roadmap

The July roadmap completion slice is shipped in deterministic, local-first form. The current implementation closes the previous open items without adding external model calls, OCR, Postgres, native Office rendering, or external sending.

## Current General Profile

- **Richer general claim extraction and matching.** General runs seed unsupported claim candidates from inspected PPTX slide text and notes, Markdown/text paragraphs, DOCX paragraphs and tables, and text-based PDF page paragraphs. Runs also write deterministic source-to-claim suggestions in `03_verification/evidence-link-suggestions.json` / `.md`.
- **Broader general review-loop support.** General review tools can create/edit/delete/merge claims, attach source support with anchors/quotes/rationale, resolve calculation risks, resolve source conflicts, accept current findings with audit records, and copy approved final artifacts locally after readiness. Runs now also write `03_verification/calculation-repair-packet.json` / `.md` with repair checklists and suggested inputs for the approval-gated calculation-risk path.
- **Evidence matching.** Evidence-link suggestions are deterministic confidence records built from term overlap, number overlap, source status, and evidence anchors. They are advisory and do not verify claims until a reviewer records an audited decision.
- **General-profile claim receipts.** Generation mode writes local Markdown claim receipts only: `04_export/final-output.md`, `04_export/formatted-output.md`, and `04_export/edited-output.md` after readiness, plus receipts and a ready manifest. Ready status is scoped to the generated Markdown/review-packet path and does not certify original input files for external shipping. Blocked runs write `04_export/general-export-refusal.md`. Native `.docx`, `.pptx`, and `.xlsx` outputs remain out of scope.
- **General PDF and document structure.** DOCX inspection captures paragraphs, headings, and tables. Text-based PDF inspection captures page paragraphs, section candidates, citation candidates, and table-like rows for general workflows. Scanned PDFs still require OCR or replacement through source-prep review.
- **Update/refresh primitive.** `npm --prefix .system run refresh` and `evidencemap_refresh_workflow` start a fresh run from a prior run, write `00_refresh/refresh-receipt.json` / `.md`, and snapshot prior review-trail artifacts without replaying old approvals onto changed evidence.
- **Richer conflict inference.** The conflict log catches same-stem files with differing status labels, conservative same-metric dated data exports, and common metric aliases such as revenue/sales, cost/expense/spend, enrollment/headcount, withdrawal/attrition/churn, and satisfaction/NPS/score while preserving the narrative-file noise guard.

## Current Legal Profile

The legal profile is artifact-backed and local-only. It supports legal source classification, passage extraction for Markdown/text/DOCX/text-based PDF, legal output specs, legal evidence maps, draft discipline checks, review-decision audit artifacts, source history, reuse boundaries, reuse-library artifacts, and a final Markdown export gate.

Postgres is intentionally out of scope for the current legal profile. Source history and reuse are stored as run artifacts unless a future recurring-workflow need justifies a store adapter.

## Future Boundaries

Future work should stay behind the same gates:

- Native Office rendering can be added only after the Markdown and receipt invariants are preserved.
- OCR can be added as source-prep, not as silent evidence.
- External LLM assistance can propose links or edits only as reviewable records with confidence, basis, and audit trail.
- Database adapters can be added only when recurring workflow evidence shows artifact-backed storage is not enough.
