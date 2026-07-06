# Roadmap Completion Spec

Status: complete.
Origin: request to complete the remaining `ROADMAP.md` items and then commit and push all.

## Goal

Close the remaining roadmap as a deterministic, local-first harness slice:

1. Broaden general claim extraction beyond deck-only seeded claims.
2. Add deterministic source-to-claim evidence-link suggestions with review status.
3. Add calculation repair packets that explain the concrete repair path for active workbook/calculation risks.
4. Add a generated Markdown edit proposal and applied edited Markdown output after readiness, without native Office rendering.
5. Improve general PDF/document structure extraction enough to expose page sections, citation candidates, table-like rows, and page-cited text.
6. Add a refresh primitive that starts a new run from a prior run while preserving a receipt and prior review-trail references.
7. Improve conflict inference across common metric aliases without treating narrative files as metric blockers.

## Non-Goals

- No external LLM/model calls.
- No OCR implementation.
- No Postgres or production database.
- No external sending, filing, or publication.
- No native `.docx`, `.pptx`, or `.xlsx` generation.
- No automatic replay of old human approvals onto changed sources.

## Implementation Plan

### 1. Evidence Link Suggestions

Add `EvidenceLinkSuggestionRecord` to the typed store.

Suggestions are deterministic records with:

- `claimId`
- `claimText`
- `evidenceId`
- `sourceId`
- `sourceName`
- `evidenceAnchor`
- `confidence`
- `basis`
- `matchedTerms`
- `matchedNumbers`
- `reviewStatus`

Build suggestions from seeded `ClaimRecord` and `SourceEvidenceRecord` using token overlap, number overlap, and source status. Suggestions never mark a claim verified by themselves; they are inputs for review tools.

Artifacts:

- `03_verification/evidence-link-suggestions.json`
- `03_verification/evidence-link-suggestions.md`

### 2. Richer General Claim Extraction

Extend seeded general claims to inspect:

- Markdown/text paragraphs.
- DOCX paragraphs and table rows.
- PDF page paragraphs and table-like rows.
- PPTX slide text, notes, and chart references.

Generated-output claims should also produce deterministic table-row claims from non-CSV document/PDF table-like evidence when fields are available.

### 3. Calculation Repair Packets

Add deterministic repair packets for active `CalculationRecord` risks and workbook-doctor findings.

Artifacts:

- `03_verification/calculation-repair-packet.json`
- `03_verification/calculation-repair-packet.md`

These packets do not resolve risks. They provide the repair checklist and suggested MCP decision inputs for the existing audited `resolve_calculation_risk` path.

### 4. Generated Edit Proposal

After a generated general run is ready, write:

- `04_export/generated-edit-proposal.json`
- `04_export/generated-edit-proposal.md`
- `04_export/edited-output.md`

The edited output is Markdown only. It is derived from verified generated claims, must preserve source IDs, evidence IDs, source dates, and excluded-source reasons, and must not change readiness.

### 5. PDF and Document Structure

Improve `pdf-text-v1` structured summaries with:

- `sections`
- `citations`
- `tableLikeRows`
- per-page paragraph anchors

Update source evidence snippets to emit table-like PDF rows as `table_row` evidence with page anchors. Keep malformed or scanned PDFs in the existing metadata/failure paths.

### 6. Refresh Primitive

Add a CLI and MCP refresh entrypoint.

Refresh behavior:

- Runs a new workflow over new/current inputs.
- Requires a prior run ID.
- Writes a local refresh receipt linking prior and new runs.
- Preserves prior decision and review artifacts by reference and snapshot when present.
- Does not silently apply prior approvals to new evidence.

Artifacts:

- `00_refresh/refresh-receipt.json`
- `00_refresh/refresh-receipt.md`

### 7. Conflict Alias Inference

Extend source-packet conflict inference for common metric aliases such as:

- revenue / sales
- cost / expense / spend
- enrollment / enrollments / headcount
- withdrawal / attrition / churn
- satisfaction / nps / score

Keep the existing protection against noisy narrative-file blockers.

## Documentation Updates

Update:

- `ROADMAP.md`: move completed roadmap items into current-state language.
- `README.md`: document refresh, suggestions, repair packets, generated edit output, and remaining non-goals.
- `.system/docs/runbook.md`: add review of suggestions, repair packet, generated edit output, and refresh.
- `.system/docs/mcp.md`: document new MCP tools and response fields.
- `.system/docs/trust-layer.md`: document that suggestions and edit proposals do not bypass gates.

## Validation

Required commands:

```bash
npm --prefix .system run typecheck
npm --prefix .system test
npm --prefix .system run inspect -- --input input/examples/capstone-report
npm --prefix .system run run -- --name "capstone-report" --kind report --input input/examples/capstone-report --generate
npm --prefix .system run verify -- --run "$(find deliverables -maxdepth 1 -type d -name 'capstone-report-*' | sort | tail -n 1)"
```

Acceptance criteria:

- Typecheck passes.
- Tests pass.
- Capstone generated run remains `export_ready` and `ready`.
- Suggestions, calculation repair packet, generated edit proposal, edited output, and refresh receipts are covered by tests.
- Existing legal-profile tests remain green.
- No generated files are moved outside `deliverables/`.
